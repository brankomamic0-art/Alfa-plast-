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

// ---- Rječnici (za obavijesti) ----
const ITEM_LABEL = { profili: 'Profili', staklo: 'Staklo', spideri: 'Spideri' };
const ITEM_STATUS_LABEL = { naruceno: 'Naručeno', u_izradi: 'U izradi', spremno_za_montazu: 'Spremno za montažu' };
const LOCATION_LABEL = { ispred_firme: 'Ispred firme', caporice: 'Skladište Čaporice', nedo: 'Skladište Nedo', na_gradilistu: 'Na gradilištu' };
const SITE_LABEL = { na_gradilistu: 'Na gradilištu', namontirano: 'Namontirano', zavrseno: 'Završeno' };
const JOB_STATUS_LABEL = { u_pripremi: 'U pripremi', spremno_za_montazu: 'Spremno za montažu', u_tijeku: 'U tijeku', zavrseno: 'Završeno' };

function canSeeJob(user, job) {
  // Admini vide sve; majstori i vozači vide bauštele od "spremno za montažu" nadalje
  if (user.role === 'admin') return true;
  return job.status !== 'u_pripremi';
}

async function loadJob(id) {
  const job = await one('SELECT j.*, u.full_name AS creator_name FROM jobs j JOIN users u ON u.id = j.created_by WHERE j.id = $1', [id]);
  if (!job) return null;
  job.items = await q('SELECT * FROM job_items WHERE job_id = $1 ORDER BY id', [id]);
  return job;
}

// ---- Lista bauštela ----
router.get('/jobs', async (req, res) => {
  const archived = req.query.archived === 'true';
  let rows = await q(
    `SELECT j.*, u.full_name AS creator_name,
       (SELECT json_agg(json_build_object('id', i.id, 'type', i.type, 'status', i.status,
                'location', i.location, 'site_status', i.site_status) ORDER BY i.id)
        FROM job_items i WHERE i.job_id = j.id) AS items
     FROM jobs j JOIN users u ON u.id = j.created_by
     WHERE j.archived = $1
     ORDER BY (j.status = 'zavrseno'), j.updated_at DESC`,
    [archived]
  );
  if (req.user.role !== 'admin') rows = rows.filter((j) => canSeeJob(req.user, j));
  res.json(rows.map((j) => ({ ...j, items: j.items || [] })));
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
  const { name, address = '', note = '', category = 'staklene_ograde', planned_date = null, items = [] } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Ime bauštele je obavezno.' });
  const validItems = items.filter((t) => ITEM_LABEL[t]);
  const job = await one(
    `INSERT INTO jobs (name, address, note, category, planned_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name.trim(), address, note, category, planned_date || null, req.user.id]
  );
  for (const t of validItems) {
    await q('INSERT INTO job_items (job_id, type) VALUES ($1,$2)', [job.id, t]);
  }
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
  const { name, address, note, planned_date, archived } = req.body || {};
  await q(
    `UPDATE jobs SET name=$1, address=$2, note=$3, planned_date=$4, archived=$5, updated_at=now() WHERE id=$6`,
    [name ?? job.name, address ?? job.address, note ?? job.note,
     planned_date === undefined ? job.planned_date : (planned_date || null),
     typeof archived === 'boolean' ? archived : job.archived, id]
  );
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
    body: status === 'spremno_za_montazu' ? 'Materijali su spremni za montažu.' : '',
    refType: 'job',
    refId: id,
  });
  res.json(await loadJob(id));
});

// ---- Dodavanje / brisanje stavki (admin) ----
router.post('/jobs/:id/items', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { type } = req.body || {};
  if (!ITEM_LABEL[type]) return res.status(400).json({ error: 'Nepoznata vrsta stavke.' });
  await q('INSERT INTO job_items (job_id, type) VALUES ($1,$2)', [id, type]);
  res.json(await loadJob(id));
});

router.delete('/jobs/:id/items/:itemId', requireAdmin, async (req, res) => {
  await q('DELETE FROM job_items WHERE id = $1 AND job_id = $2', [Number(req.params.itemId), Number(req.params.id)]);
  res.json(await loadJob(Number(req.params.id)));
});

// ---- Status pripreme stavke (admin): naruceno / u_izradi / spremno_za_montazu ----
router.put('/jobs/:id/items/:itemId/status', requireAdmin, async (req, res) => {
  const jobId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { status, comment = '' } = req.body || {};
  if (!ITEM_STATUS_LABEL[status]) return res.status(400).json({ error: 'Nepoznat status.' });
  const job = await one('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const item = await one('SELECT * FROM job_items WHERE id = $1 AND job_id = $2', [itemId, jobId]);
  if (!job || !item) return res.status(404).json({ error: 'Stavka ne postoji.' });

  await q('UPDATE job_items SET status = $1, updated_at = now() WHERE id = $2', [status, itemId]);
  await q('UPDATE jobs SET updated_at = now() WHERE id = $1', [jobId]);
  await q(
    `INSERT INTO job_events (job_id, item_id, user_id, kind, body) VALUES ($1,$2,$3,'status',$4)`,
    [jobId, itemId, req.user.id,
     `${ITEM_LABEL[item.type]}: ${ITEM_STATUS_LABEL[status]}${comment ? ' — ' + comment : ''}`]
  );

  // Ako su SVE stavke spremne za montažu, automatski podigni status bauštele + obavijesti sve
  const items = await q('SELECT * FROM job_items WHERE job_id = $1', [jobId]);
  const allReady = items.length > 0 && items.every((i) => i.status === 'spremno_za_montazu');
  if (allReady && job.status === 'u_pripremi') {
    await q(`UPDATE jobs SET status = 'spremno_za_montazu', updated_at = now() WHERE id = $1`, [jobId]);
    await notify({
      recipients: await userIds(['admin', 'majstor', 'vozac']),
      actorId: req.user.id,
      type: 'job_status',
      title: `Bauštela "${job.name}": Spremno za montažu`,
      body: 'Sve stavke su spremne.',
      refType: 'job',
      refId: jobId,
    });
  } else {
    await notify({
      recipients: await userIds(['admin']),
      actorId: req.user.id,
      type: 'item_status',
      title: `"${job.name}" — ${ITEM_LABEL[item.type]}: ${ITEM_STATUS_LABEL[status]}`,
      body: comment,
      refType: 'job',
      refId: jobId,
    });
  }
  res.json(await loadJob(jobId));
});

// ---- Transport lokacija stavke (vozač / majstor / admin) + fotka + komentar ----
router.put('/jobs/:id/items/:itemId/location', upload.single('photo'), async (req, res) => {
  const jobId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { location, comment = '' } = req.body || {};
  if (!LOCATION_LABEL[location]) return res.status(400).json({ error: 'Nepoznata lokacija.' });
  const job = await one('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const item = await one('SELECT * FROM job_items WHERE id = $1 AND job_id = $2', [itemId, jobId]);
  if (!job || !item) return res.status(404).json({ error: 'Stavka ne postoji.' });
  if (!canSeeJob(req.user, job)) return res.status(403).json({ error: 'Bauštela još nije spremna za montažu.' });

  const siteStatus = location === 'na_gradilistu' ? 'na_gradilistu' : null;
  await q('UPDATE job_items SET location = $1, site_status = COALESCE($2, site_status), updated_at = now() WHERE id = $3',
    [location, siteStatus, itemId]);
  await q('UPDATE jobs SET updated_at = now() WHERE id = $1', [jobId]);
  const photoPath = req.file ? `/uploads/${req.file.filename}` : null;
  await q(
    `INSERT INTO job_events (job_id, item_id, user_id, kind, body, photo_path) VALUES ($1,$2,$3,'transport',$4,$5)`,
    [jobId, itemId, req.user.id,
     `${ITEM_LABEL[item.type]} → ${LOCATION_LABEL[location]}${comment ? ' — ' + comment : ''}`, photoPath]
  );
  await notify({
    recipients: await userIds(),
    actorId: req.user.id,
    type: 'transport',
    title: `"${job.name}": ${ITEM_LABEL[item.type]} → ${LOCATION_LABEL[location]}`,
    body: `${req.user.full_name}${comment ? ' — ' + comment : ''}`,
    refType: 'job',
    refId: jobId,
  });
  res.json(await loadJob(jobId));
});

// ---- Status na gradilištu (majstor / admin) ----
router.put('/jobs/:id/items/:itemId/site-status', async (req, res) => {
  const jobId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { site_status, comment = '' } = req.body || {};
  if (!SITE_LABEL[site_status]) return res.status(400).json({ error: 'Nepoznat status.' });
  if (req.user.role === 'vozac')
    return res.status(403).json({ error: 'Status montaže mijenjaju majstori ili admin.' });
  const job = await one('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const item = await one('SELECT * FROM job_items WHERE id = $1 AND job_id = $2', [itemId, jobId]);
  if (!job || !item) return res.status(404).json({ error: 'Stavka ne postoji.' });
  if (!canSeeJob(req.user, job)) return res.status(403).json({ error: 'Bauštela još nije spremna za montažu.' });

  await q('UPDATE job_items SET site_status = $1, updated_at = now() WHERE id = $2', [site_status, itemId]);
  await q('UPDATE jobs SET updated_at = now() WHERE id = $1', [jobId]);
  await q(
    `INSERT INTO job_events (job_id, item_id, user_id, kind, body) VALUES ($1,$2,$3,'status',$4)`,
    [jobId, itemId, req.user.id,
     `${ITEM_LABEL[item.type]}: ${SITE_LABEL[site_status]}${comment ? ' — ' + comment : ''}`]
  );
  await notify({
    recipients: await userIds(['admin']),
    actorId: req.user.id,
    type: 'site_status',
    title: `"${job.name}" — ${ITEM_LABEL[item.type]}: ${SITE_LABEL[site_status]}`,
    body: `${req.user.full_name}${comment ? ' — ' + comment : ''}`,
    refType: 'job',
    refId: jobId,
  });
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
