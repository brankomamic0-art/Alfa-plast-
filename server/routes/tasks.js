import { Router } from 'express';
import { q, one } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { notify, userIds } from '../notify.js';

const router = Router();
router.use(requireAuth);

const STATUS_LABEL = { poslano: 'Poslano', primljeno: 'Primljeno', zavrseno: 'Završeno' };

// ---- Lista zadataka ----
// admin vidi sve; ostali vide svoje (dodijeljene njima)
router.get('/tasks', async (req, res) => {
  const base = `
    SELECT t.*, ua.full_name AS assigned_name, uc.full_name AS creator_name,
           (SELECT COUNT(*)::int FROM task_comments c WHERE c.task_id = t.id) AS comment_count
    FROM tasks t
    JOIN users ua ON ua.id = t.assigned_to
    JOIN users uc ON uc.id = t.created_by`;
  const rows =
    req.user.role === 'admin'
      ? await q(`${base} ORDER BY (t.status = 'zavrseno'), t.created_at DESC`)
      : await q(`${base} WHERE t.assigned_to = $1 ORDER BY (t.status = 'zavrseno'), t.created_at DESC`, [req.user.id]);
  res.json(rows);
});

// ---- Kreiranje zadatka (admin) ----
router.post('/tasks', requireAdmin, async (req, res) => {
  const { title, description = '', assigned_to, due_date = null, job_id = null } = req.body || {};
  if (!title || !assigned_to) return res.status(400).json({ error: 'Naslov i osoba su obavezni.' });
  const task = await one(
    `INSERT INTO tasks (title, description, assigned_to, created_by, due_date, job_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [title.trim(), description, assigned_to, req.user.id, due_date || null, job_id]
  );
  await notify({
    recipients: [assigned_to],
    actorId: req.user.id,
    type: 'task_novi',
    title: 'Novi zadatak',
    body: `${req.user.full_name}: "${task.title}"`,
    refType: 'task',
    refId: task.id,
  });
  res.status(201).json(task);
});

// ---- Promjena statusa ----
// Dodijeljeni korisnik: poslano -> primljeno -> zavrseno. Admin: bilo koji status.
router.put('/tasks/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!STATUS_LABEL[status]) return res.status(400).json({ error: 'Nepoznat status.' });
  const task = await one('SELECT * FROM tasks WHERE id = $1', [id]);
  if (!task) return res.status(404).json({ error: 'Zadatak ne postoji.' });

  const isAdmin = req.user.role === 'admin';
  const isAssignee = task.assigned_to === req.user.id;
  if (!isAdmin && !isAssignee)
    return res.status(403).json({ error: 'Ovaj zadatak nije dodijeljen vama.' });
  if (!isAdmin) {
    const flow = { poslano: 'primljeno', primljeno: 'zavrseno' };
    if (flow[task.status] !== status)
      return res.status(400).json({ error: `Iz statusa "${STATUS_LABEL[task.status]}" možete samo u "${STATUS_LABEL[flow[task.status]] || '—'}".` });
  }

  const updated = await one(
    `UPDATE tasks SET status = $1, updated_at = now(), last_reminded = NULL WHERE id = $2 RETURNING *`,
    [status, id]
  );

  // Obavijesti: kreatora zadatka + admine
  const admins = await userIds(['admin']);
  await notify({
    recipients: [task.created_by, task.assigned_to, ...admins],
    actorId: req.user.id,
    type: 'task_status',
    title: `Zadatak: ${STATUS_LABEL[status]}`,
    body: `${req.user.full_name} — "${task.title}"`,
    refType: 'task',
    refId: id,
  });
  res.json(updated);
});

// ---- Uređivanje / brisanje (admin) ----
router.put('/tasks/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const task = await one('SELECT * FROM tasks WHERE id = $1', [id]);
  if (!task) return res.status(404).json({ error: 'Zadatak ne postoji.' });
  const { title, description, assigned_to, due_date } = req.body || {};
  const updated = await one(
    `UPDATE tasks SET title=$1, description=$2, assigned_to=$3, due_date=$4, updated_at=now()
     WHERE id=$5 RETURNING *`,
    [title ?? task.title, description ?? task.description, assigned_to ?? task.assigned_to,
     due_date === undefined ? task.due_date : (due_date || null), id]
  );
  res.json(updated);
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
  await notify({
    recipients: [task.created_by, task.assigned_to, ...admins],
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
