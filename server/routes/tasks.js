import { Router } from 'express';
import { q, one } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { notify, userIds } from '../notify.js';

const router = Router();
router.use(requireAuth);

const STATUS_LABEL = { poslano: 'Poslano', primljeno: 'Primljeno', zavrseno: 'Završeno' };

/** Lista id-eva izvršitelja iz tijela zahtjeva (podržava i stari `assigned_to`). */
function assigneeIds(body) {
  const raw = Array.isArray(body?.assignee_ids)
    ? body.assignee_ids
    : body?.assigned_to !== undefined && body?.assigned_to !== null
      ? [body.assigned_to]
      : [];
  const ids = raw.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)];
}

/** Zbirni status zadatka: završen tek kad su svi gotovi; primljen čim ga netko preuzme. */
function rollUp(statuses) {
  if (statuses.length === 0) return 'poslano';
  if (statuses.every((s) => s === 'zavrseno')) return 'zavrseno';
  if (statuses.some((s) => s !== 'poslano')) return 'primljeno';
  return 'poslano';
}

/** Osvježi zbirni status i glavnog izvršitelja zadatka iz tablice izvršitelja. */
async function syncTask(taskId) {
  const rows = await q('SELECT user_id, status FROM task_assignees WHERE task_id = $1 ORDER BY user_id', [taskId]);
  const status = rollUp(rows.map((r) => r.status));
  return one(
    `UPDATE tasks SET status = $1, assigned_to = COALESCE($2, assigned_to), updated_at = now()
     WHERE id = $3 RETURNING *`,
    [status, rows[0]?.user_id ?? null, taskId]
  );
}

/** Izvršitelji grupirani po zadatku. */
async function assigneesByTask(taskIds) {
  if (taskIds.length === 0) return new Map();
  const rows = await q(
    `SELECT a.task_id, a.user_id, a.status, u.full_name, u.role,
            v.registration AS vehicle_registration
       FROM task_assignees a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN tasks t ON t.id = a.task_id
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
      WHERE a.task_id = ANY($1::int[])
      ORDER BY u.full_name`,
    [taskIds]
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.task_id)) map.set(r.task_id, []);
    map.get(r.task_id).push({
      user_id: r.user_id,
      full_name: r.full_name,
      role: r.role,
      status: r.status,
    });
  }
  return map;
}

/** Zadatak s izvršiteljima i statusom prijavljenog korisnika. */
async function withAssignees(rows, userId) {
  const map = await assigneesByTask(rows.map((t) => t.id));
  return rows.map((t) => {
    const assignees = map.get(t.id) || [];
    const mine = assignees.find((a) => a.user_id === userId);
    return {
      ...t,
      assignees,
      assigned_name: assignees.map((a) => a.full_name).join(', '),
      my_status: mine ? mine.status : null,
    };
  });
}

// ---- Lista zadataka ----
// admin vidi sve; ostali vide one u kojima su izvršitelji
router.get('/tasks', async (req, res) => {
  const base = `
    SELECT t.*, uc.full_name AS creator_name,
           v.registration AS vehicle_registration,
           (SELECT COUNT(*)::int FROM task_comments c WHERE c.task_id = t.id) AS comment_count
    FROM tasks t
    JOIN users uc ON uc.id = t.created_by
    LEFT JOIN vehicles v ON v.id = t.vehicle_id`;
  const rows =
    req.user.role === 'admin'
      ? await q(`${base} ORDER BY (t.status = 'zavrseno'), t.created_at DESC`)
      : await q(
          `${base} WHERE EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = $1)
           ORDER BY (t.status = 'zavrseno'), t.created_at DESC`,
          [req.user.id]
        );
  res.json(await withAssignees(rows, req.user.id));
});

// ---- Kreiranje zadatka (admin) ----
// Zadatak se može dodijeliti većem broju ljudi odjednom.
router.post('/tasks', requireAdmin, async (req, res) => {
  const { title, description = '', due_date = null, job_id = null, vehicle_id = null } = req.body || {};
  const ids = assigneeIds(req.body);
  if (!title?.trim()) return res.status(400).json({ error: 'Naslov je obavezan.' });
  if (ids.length === 0) return res.status(400).json({ error: 'Odaberite barem jednu osobu.' });

  const people = await q('SELECT id, full_name FROM users WHERE id = ANY($1::int[])', [ids]);
  if (people.length !== ids.length) return res.status(404).json({ error: 'Neki od odabranih korisnika ne postoje.' });

  const task = await one(
    `INSERT INTO tasks (title, description, assigned_to, created_by, due_date, job_id, vehicle_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [title.trim(), description, ids[0], req.user.id, due_date || null, job_id, vehicle_id || null]
  );
  for (const uid of ids) {
    await q('INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2)', [task.id, uid]);
  }

  await notify({
    recipients: ids,
    actorId: req.user.id,
    type: 'task_novi',
    title: 'Novi zadatak',
    body: `${req.user.full_name}: "${task.title}"`,
    refType: 'task',
    refId: task.id,
  });
  const [full] = await withAssignees([task], req.user.id);
  res.status(201).json(full);
});

// ---- Promjena statusa ----
// Izvršitelj mijenja svoj status: poslano -> primljeno -> zavrseno.
// Admin može postaviti bilo koji status — svima ili pojedinoj osobi (`user_id`).
router.put('/tasks/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const { status, user_id = null } = req.body || {};
  if (!STATUS_LABEL[status]) return res.status(400).json({ error: 'Nepoznat status.' });
  const task = await one('SELECT * FROM tasks WHERE id = $1', [id]);
  if (!task) return res.status(404).json({ error: 'Zadatak ne postoji.' });

  const isAdmin = req.user.role === 'admin';
  const mine = await one('SELECT * FROM task_assignees WHERE task_id = $1 AND user_id = $2', [id, req.user.id]);
  if (!isAdmin && !mine) return res.status(403).json({ error: 'Ovaj zadatak nije dodijeljen vama.' });

  if (isAdmin) {
    const target = user_id ? Number(user_id) : null;
    if (target) {
      const row = await one('SELECT * FROM task_assignees WHERE task_id = $1 AND user_id = $2', [id, target]);
      if (!row) return res.status(404).json({ error: 'Ta osoba nije na ovom zadatku.' });
      await q(
        `UPDATE task_assignees SET status = $1, updated_at = now(), last_reminded = NULL
          WHERE task_id = $2 AND user_id = $3`,
        [status, id, target]
      );
    } else {
      await q(
        `UPDATE task_assignees SET status = $1, updated_at = now(), last_reminded = NULL WHERE task_id = $2`,
        [status, id]
      );
    }
  } else {
    const flow = { poslano: 'primljeno', primljeno: 'zavrseno' };
    if (flow[mine.status] !== status) {
      return res.status(400).json({
        error: `Iz statusa "${STATUS_LABEL[mine.status]}" možete samo u "${STATUS_LABEL[flow[mine.status]] || '—'}".`,
      });
    }
    await q(
      `UPDATE task_assignees SET status = $1, updated_at = now(), last_reminded = NULL
        WHERE task_id = $2 AND user_id = $3`,
      [status, id, req.user.id]
    );
  }

  const updated = await syncTask(id);

  // Obavijesti: kreatora zadatka, ostale izvršitelje i admine
  const admins = await userIds(['admin']);
  const others = (await q('SELECT user_id FROM task_assignees WHERE task_id = $1', [id])).map((r) => r.user_id);
  await notify({
    recipients: [task.created_by, ...others, ...admins],
    actorId: req.user.id,
    type: 'task_status',
    title: `Zadatak: ${STATUS_LABEL[status]}`,
    body: `${req.user.full_name} — "${task.title}"`,
    refType: 'task',
    refId: id,
  });
  const [full] = await withAssignees([updated], req.user.id);
  res.json(full);
});

// ---- Uređivanje / brisanje (admin) ----
router.put('/tasks/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const task = await one('SELECT * FROM tasks WHERE id = $1', [id]);
  if (!task) return res.status(404).json({ error: 'Zadatak ne postoji.' });
  const { title, description, due_date, vehicle_id } = req.body || {};

  // Popis izvršitelja se mijenja samo ako je poslan
  const hasList = Array.isArray(req.body?.assignee_ids) || req.body?.assigned_to !== undefined;
  if (hasList) {
    const ids = assigneeIds(req.body);
    if (ids.length === 0) return res.status(400).json({ error: 'Zadatak mora imati barem jednu osobu.' });
    const people = await q('SELECT id FROM users WHERE id = ANY($1::int[])', [ids]);
    if (people.length !== ids.length) return res.status(404).json({ error: 'Neki od odabranih korisnika ne postoje.' });

    const before = (await q('SELECT user_id FROM task_assignees WHERE task_id = $1', [id])).map((r) => r.user_id);
    await q('DELETE FROM task_assignees WHERE task_id = $1 AND user_id <> ALL($2::int[])', [id, ids]);
    for (const uid of ids) {
      await q('INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, uid]);
    }
    const added = ids.filter((uid) => !before.includes(uid));
    if (added.length > 0) {
      await notify({
        recipients: added,
        actorId: req.user.id,
        type: 'task_novi',
        title: 'Novi zadatak',
        body: `${req.user.full_name}: "${task.title}"`,
        refType: 'task',
        refId: id,
      });
    }
  }

  await q(
    `UPDATE tasks SET title=$1, description=$2, due_date=$3, vehicle_id=$4, updated_at=now() WHERE id=$5`,
    [
      title ?? task.title,
      description ?? task.description,
      due_date === undefined ? task.due_date : due_date || null,
      vehicle_id === undefined ? task.vehicle_id : vehicle_id || null,
      id,
    ]
  );
  const updated = await syncTask(id);
  const [full] = await withAssignees([updated], req.user.id);
  res.json(full);
});

router.delete('/tasks/:id', requireAdmin, async (req, res) => {
  await q('DELETE FROM tasks WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

// ---- Komentari ----
router.get('/tasks/:id/comments', async (req, res) => {
  const rows = await q(
    `SELECT c.*, u.full_name FROM task_comments c JOIN users u ON u.id = c.user_id
     WHERE c.task_id = $1 ORDER BY c.created_at`,
    [Number(req.params.id)]
  );
  res.json(rows);
});

router.post('/tasks/:id/comments', async (req, res) => {
  const id = Number(req.params.id);
  const { body } = req.body || {};
  if (!body?.trim()) return res.status(400).json({ error: 'Komentar ne smije biti prazan.' });
  const task = await one('SELECT * FROM tasks WHERE id = $1', [id]);
  if (!task) return res.status(404).json({ error: 'Zadatak ne postoji.' });
  const comment = await one(
    `INSERT INTO task_comments (task_id, user_id, body) VALUES ($1,$2,$3) RETURNING *`,
    [id, req.user.id, body.trim()]
  );
  const admins = await userIds(['admin']);
  const assignees = (await q('SELECT user_id FROM task_assignees WHERE task_id = $1', [id])).map((r) => r.user_id);
  await notify({
    recipients: [task.created_by, ...assignees, ...admins],
    actorId: req.user.id,
    type: 'task_komentar',
    title: 'Novi komentar na zadatku',
    body: `${req.user.full_name} — "${task.title}": ${body.trim().slice(0, 80)}`,
    refType: 'task',
    refId: id,
  });
  res.status(201).json({ ...comment, full_name: req.user.full_name });
});

export default router;
