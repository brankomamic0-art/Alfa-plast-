import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { q, one } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { notify, userIds } from '../notify.js';

const router = Router();
router.use(requireAuth);

// ---- Upload fotografija ----
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    /image\/(jpe?g|png|webp|heic|heif)/i.test(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Dozvoljene su samo fotografije.')),
});

const JOB_STATUS_LABEL = { u_pripremi: 'U pripremi', spremno_za_montazu: 'Spremno za montažu', u_tijeku: 'U tijeku', zavrseno: 'Završeno' };
const WORK_KIND_LABEL = { odradeno: 'Odrađeno', za_odraditi: 'Za odraditi' };

function canSeeJob(user, job) {
  // Admini vide sve; majstori i vozači vide bauštele od "spremno za montažu" nadalje
  if (user.role === 'admin') return true;
  return job.status !== 'u_pripremi';
}

/** Tijek rade smiju upisivati majstori i administrator; vozači samo čitaju. */
function canLogWork(user) {
  return user.role !== 'vozac';
}

function toDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** Lista id-eva korisnika iz tijela zahtjeva. */
function userIdList(raw) {
  const ids = (Array.isArray(raw) ? raw : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)];
}

/**
 * Voditelj bauštele iz tijela zahtjeva: null kad nije odabran,
 * false kad korisnik ne postoji ili ne može voditi ekipu (vozač, neaktivan).
 */
async function leaderId(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const user = await one('SELECT id, role, active FROM users WHERE id = $1', [Number(raw)]);
  if (!user || user.role === 'vozac' || user.active === false) return false;
  return user.id;
}

/** Majstori upisani na arhiviranu bauštelu. */
async function archiveWorkers(jobIds) {
  if (jobIds.length === 0) return new Map();
  const rows = await q(
    `SELECT w.job_id, w.user_id, u.full_name FROM job_archive_workers w
       JOIN users u ON u.id = w.user_id
      WHERE w.job_id = ANY($1::int[]) ORDER BY u.full_name`,
    [jobIds]
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.job_id)) map.set(r.job_id, []);
    map.get(r.job_id).push({ user_id: r.user_id, full_name: r.full_name });
  }
  return map;
}

/** Zapisi tijeka rade s majstorima koji su bili. */
async function workLogs(jobId) {
  const logs = await q(
    `SELECT l.*, u.full_name AS created_by_name, d.full_name AS done_by_name
       FROM job_work_logs l
       JOIN users u ON u.id = l.created_by
       LEFT JOIN users d ON d.id = l.done_by
      WHERE l.job_id = $1
      ORDER BY l.done, COALESCE(l.work_date, l.created_at::date) DESC, l.id DESC`,
    [jobId]
  );
  if (logs.length === 0) return [];
  const rows = await q(
    `SELECT w.log_id, w.user_id, u.full_name FROM job_work_log_workers w
       JOIN users u ON u.id = w.user_id
      WHERE w.log_id = ANY($1::int[]) ORDER BY u.full_name`,
    [logs.map((l) => l.id)]
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.log_id)) map.set(r.log_id, []);
    map.get(r.log_id).push({ user_id: r.user_id, full_name: r.full_name });
  }
  return logs.map((l) => ({ ...l, workers: map.get(l.id) || [] }));
}

async function loadJob(id) {
  const job = await one(
    `SELECT j.*, u.full_name AS creator_name, l.full_name AS leader_name
       FROM jobs j JOIN users u ON u.id = j.created_by LEFT JOIN users l ON l.id = j.leader_id
      WHERE j.id = $1`,
    [id]
  );
  if (!job) return null;
  job.work_logs = await workLogs(id);
  job.archive_workers = (await archiveWorkers([id])).get(id) || [];
  return job;
}

// ---- Lista bauštela ----
router.get('/jobs', async (req, res) => {
  const archived = req.query.archived === 'true';
  let rows = await q(
    `SELECT j.*, u.full_name AS creator_name, ld.full_name AS leader_name,
       (SELECT count(*)::int FROM job_work_logs l WHERE l.job_id = j.id AND l.kind = 'odradeno') AS done_count,
       (SELECT count(*)::int FROM job_work_logs l WHERE l.job_id = j.id AND l.kind = 'za_odraditi' AND l.done = FALSE) AS todo_count
     FROM jobs j JOIN users u ON u.id = j.created_by LEFT JOIN users ld ON ld.id = j.leader_id
     WHERE j.archived = $1
     ORDER BY (j.status = 'zavrseno'), COALESCE(j.archived_date, j.updated_at::date) DESC, j.updated_at DESC`,
    [archived]
  );
  if (req.user.role !== 'admin') rows = rows.filter((j) => canSeeJob(req.user, j));
  const workers = await archiveWorkers(rows.map((j) => j.id));
  res.json(rows.map((j) => ({ ...j, archive_workers: workers.get(j.id) || [] })));
});

// ---- Detalj bauštele s događajima ----
router.get('/jobs/:id', async (req, res) => {
  const job = await loadJob(Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Bauštela ne postoji.' });
  if (!canSeeJob(req.user, job)) return res.status(403).json({ error: 'Bauštela još nije spremna za montažu.' });
  job.events = await q(
    `SELECT e.*, u.full_name FROM job_events e JOIN users u ON u.id = e.user_id
     WHERE e.job_id = $1 ORDER BY e.created_at DESC`,
    [job.id]
  );
  res.json(job);
});

// ---- Kreiranje bauštele (admin) ----
router.post('/jobs', requireAdmin, async (req, res) => {
  const {
    name, address = '', note = '', category = 'staklene_ograde', planned_date = null, leader_id = null,
  } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Ime bauštele je obavezno.' });
  const leader = await leaderId(leader_id);
  if (leader === false) return res.status(400).json({ error: 'Odabrani voditelj ne postoji ili ne može voditi ekipu.' });
  const job = await one(
    `INSERT INTO jobs (name, address, note, category, planned_date, leader_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name.trim(), address, note, category, planned_date || null, leader, req.user.id]
  );
  const admins = await userIds(['admin']);
  await notify({
    recipients: admins,
    actorId: req.user.id,
    type: 'job_nova',
    title: 'Nova bauštela',
    body: `${req.user.full_name} — "${job.name}"`,
    refType: 'job',
    refId: job.id,
  });
  res.status(201).json(await loadJob(job.id));
});

// ---- Uređivanje bauštele (admin) ----
router.put('/jobs/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const job = await one('SELECT * FROM jobs WHERE id = $1', [id]);
  if (!job) return res.status(404).json({ error: 'Bauštela ne postoji.' });
  const { name, address, note, planned_date, archived, leader_id } = req.body || {};
  const leader = leader_id === undefined ? job.leader_id : await leaderId(leader_id);
  if (leader === false) return res.status(400).json({ error: 'Odabrani voditelj ne postoji ili ne može voditi ekipu.' });
  await q(
    `UPDATE jobs SET name=$1, address=$2, note=$3, planned_date=$4, archived=$5, leader_id=$6, updated_at=now()
     WHERE id=$7`,
    [name ?? job.name, address ?? job.address, note ?? job.note,
     planned_date === undefined ? job.planned_date : (planned_date || null),
     typeof archived === 'boolean' ? archived : job.archived, leader, id]
  );
  res.json(await loadJob(id));
});

// ---- Arhiviranje (admin): majstori koji su radili + datum ----
router.put('/jobs/:id/archive', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const job = await one('SELECT * FROM jobs WHERE id = $1', [id]);
  if (!job) return res.status(404).json({ error: 'Bauštela ne postoji.' });

  const { archived = true, archived_date = null, worker_ids } = req.body || {};
  if (archived_date && !toDate(archived_date)) return res.status(400).json({ error: 'Neispravan datum.' });

  if (worker_ids !== undefined) {
    const ids = userIdList(worker_ids);
    const people = await q('SELECT id FROM users WHERE id = ANY($1::int[])', [ids]);
    if (people.length !== ids.length) return res.status(404).json({ error: 'Neki od odabranih majstora ne postoje.' });
    await q('DELETE FROM job_archive_workers WHERE job_id = $1', [id]);
    for (const uid of ids) {
      await q('INSERT INTO job_archive_workers (job_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, uid]);
    }
  }

  await q('UPDATE jobs SET archived = $1, archived_date = $2, updated_at = now() WHERE id = $3', [
    archived === true,
    archived_date || (archived === true ? job.archived_date : null),
    id,
  ]);
  res.json(await loadJob(id));
});

// ---- Status cijele bauštele (admin) ----
router.put('/jobs/:id/status', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!JOB_STATUS_LABEL[status]) return res.status(400).json({ error: 'Nepoznat status.' });
  const job = await one('SELECT * FROM jobs WHERE id = $1', [id]);
  if (!job) return res.status(404).json({ error: 'Bauštela ne postoji.' });
  await q('UPDATE jobs SET status = $1, updated_at = now() WHERE id = $2', [status, id]);
  await q(
    `INSERT INTO job_events (job_id, user_id, kind, body) VALUES ($1,$2,'status',$3)`,
    [id, req.user.id, `Status bauštele: ${JOB_STATUS_LABEL[status]}`]
  );
  // Kad je spremno za montažu -> obavijesti majstore i vozače
  const recipients = status === 'spremno_za_montazu'
    ? await userIds(['admin', 'majstor', 'vozac'])
    : await userIds(['admin']);
  await notify({
    recipients,
    actorId: req.user.id,
    type: 'job_status',
    title: `Bauštela "${job.name}": ${JOB_STATUS_LABEL[status]}`,
    body: status === 'spremno_za_montazu' ? 'Bauštela je spremna za montažu.' : '',
    refType: 'job',
    refId: id,
  });
  res.json(await loadJob(id));
});

// =====================================================
// TIJEK RADE — što je odrađeno / što se mora odraditi
// Upisuju majstori i administrator; sva polja su opcionalna.
// =====================================================
router.post('/jobs/:id/work-logs', async (req, res) => {
  const jobId = Number(req.params.id);
  const { kind, work_date = null, body = '', worker_ids = [], crew = '' } = req.body || {};
  if (!WORK_KIND_LABEL[kind]) return res.status(400).json({ error: 'Nepoznata vrsta zapisa.' });

  const job = await one('SELECT * FROM jobs WHERE id = $1', [jobId]);
  if (!job) return res.status(404).json({ error: 'Bauštela ne postoji.' });
  if (!canSeeJob(req.user, job)) return res.status(403).json({ error: 'Bauštela još nije spremna za montažu.' });
  if (!canLogWork(req.user)) return res.status(403).json({ error: 'Tijek rade upisuju majstori ili administrator.' });

  const date = work_date ? toDate(work_date) : null;
  if (work_date && !date) return res.status(400).json({ error: 'Neispravan datum.' });

  const ids = userIdList(worker_ids);
  if (ids.length > 0) {
    const people = await q('SELECT id FROM users WHERE id = ANY($1::int[])', [ids]);
    if (people.length !== ids.length) return res.status(404).json({ error: 'Neki od odabranih majstora ne postoje.' });
  }

  const text = String(body).trim();
  const crewText = String(crew ?? '').trim();
  if (!text && ids.length === 0 && !date && !crewText) {
    return res.status(400).json({ error: 'Upišite barem komentar, majstora ili datum.' });
  }

  const log = await one(
    `INSERT INTO job_work_logs (job_id, kind, work_date, body, crew, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [jobId, kind, date, text, crewText, req.user.id]
  );
  for (const uid of ids) {
    await q('INSERT INTO job_work_log_workers (log_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [log.id, uid]);
  }
  await q('UPDATE jobs SET updated_at = now() WHERE id = $1', [jobId]);

  await notify({
    recipients: await userIds(['admin']),
    actorId: req.user.id,
    type: 'job_tijek',
    title: `"${job.name}": ${WORK_KIND_LABEL[kind]}`,
    body: `${req.user.full_name}${text ? ' — ' + text.slice(0, 100) : ''}`,
    refType: 'job',
    refId: jobId,
  });
  res.status(201).json(await loadJob(jobId));
});

// ---- Izmjena zapisa: kvačica "odrađeno" ili uređivanje teksta/datuma ----
router.put('/jobs/:id/work-logs/:logId', async (req, res) => {
  const jobId = Number(req.params.id);
  const logId = Number(req.params.logId);
  const log = await one('SELECT * FROM job_work_logs WHERE id = $1 AND job_id = $2', [logId, jobId]);
  if (!log) return res.status(404).json({ error: 'Zapis ne postoji.' });
  if (!canLogWork(req.user)) return res.status(403).json({ error: 'Tijek rade upisuju majstori ili administrator.' });

  const { done, body, work_date } = req.body || {};
  if (work_date !== undefined && work_date !== null && work_date !== '' && !toDate(work_date)) {
    return res.status(400).json({ error: 'Neispravan datum.' });
  }
  const nextDone = typeof done === 'boolean' ? done : log.done;

  await q(
    `UPDATE job_work_logs
        SET body = $1,
            work_date = $2,
            done = $3::boolean,
            done_by = CASE WHEN $3::boolean THEN $4::int ELSE NULL END,
            done_at = CASE WHEN $3::boolean THEN COALESCE(done_at, now()) ELSE NULL END
      WHERE id = $5`,
    [
      body === undefined ? log.body : String(body).trim(),
      work_date === undefined ? log.work_date : work_date || null,
      nextDone,
      req.user.id,
      logId,
    ]
  );
  await q('UPDATE jobs SET updated_at = now() WHERE id = $1', [jobId]);
  res.json(await loadJob(jobId));
});

router.delete('/jobs/:id/work-logs/:logId', async (req, res) => {
  const jobId = Number(req.params.id);
  const log = await one('SELECT * FROM job_work_logs WHERE id = $1 AND job_id = $2', [Number(req.params.logId), jobId]);
  if (!log) return res.status(404).json({ error: 'Zapis ne postoji.' });
  // Briše administrator ili onaj tko je zapis unio
  if (req.user.role !== 'admin' && log.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Zapis može obrisati administrator ili onaj tko ga je unio.' });
  }
  await q('DELETE FROM job_work_logs WHERE id = $1', [log.id]);
  res.json(await loadJob(jobId));
});

// ---- Događaji: komentar / problem / dnevni napredak / napomena za sljedeću ekipu / fotografija ----
router.post('/jobs/:id/events', upload.single('photo'), async (req, res) => {
  const jobId = Number(req.params.id);
  const { kind, body = '', item_id = null } = req.body || {};
  const allowed = ['komentar', 'problem', 'napredak', 'napomena', 'fotografija'];
  if (!allowed.includes(kind)) return res.status(400).json({ error: 'Nepoznata vrsta zapisa.' });
  const job = await one('SELECT * FROM jobs WHERE id = $1', [jobId]);
  if (!job) return res.status(404).json({ error: 'Bauštela ne postoji.' });
  if (!canSeeJob(req.user, job)) return res.status(403).json({ error: 'Bauštela još nije spremna za montažu.' });
  const photoPath = req.file ? `/uploads/${req.file.filename}` : null;
  if (!body.trim() && !photoPath) return res.status(400).json({ error: 'Dodajte komentar ili fotografiju.' });

  const event = await one(
    `INSERT INTO job_events (job_id, item_id, user_id, kind, body, photo_path)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [jobId, item_id ? Number(item_id) : null, req.user.id, kind, body.trim(), photoPath]
  );
  await q('UPDATE jobs SET updated_at = now() WHERE id = $1', [jobId]);

  const KIND_TITLE = {
    komentar: 'Novi komentar',
    problem: '⚠ Prijavljen problem',
    napredak: 'Dnevni napredak',
    napomena: 'Napomena za sljedeću ekipu',
    fotografija: 'Nove fotografije',
  };
  const recipients = kind === 'problem' ? await userIds() : await userIds(['admin']);
  await notify({
    recipients,
    actorId: req.user.id,
    type: `job_${kind}`,
    title: `"${job.name}": ${KIND_TITLE[kind]}`,
    body: `${req.user.full_name}${body ? ' — ' + body.trim().slice(0, 100) : ''}`,
    refType: 'job',
    refId: jobId,
  });
  res.status(201).json({ ...event, full_name: req.user.full_name });
});

// ---- Brisanje bauštele (admin) ----
router.delete('/jobs/:id', requireAdmin, async (req, res) => {
  await q('DELETE FROM jobs WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

export default router;
