import { Router } from 'express';
import { q, one } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

// ---- Lista obavijesti (zadnjih 50) + broj nepročitanih ----
router.get('/notifications', async (req, res) => {
  const rows = await q(
    `SELECT n.*, u.full_name AS actor_name
     FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
     WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 50`,
    [req.user.id]
  );
  const unread = await one(
    'SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read = FALSE',
    [req.user.id]
  );
  res.json({ notifications: rows, unread: unread.c });
});

// ---- Označi sve kao pročitano ----
router.put('/notifications/read-all', async (req, res) => {
  await q('UPDATE notifications SET read = TRUE WHERE user_id = $1', [req.user.id]);
  res.json({ ok: true });
});

// ---- Označi jednu ----
router.put('/notifications/:id/read', async (req, res) => {
  await q('UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2', [
    Number(req.params.id),
    req.user.id,
  ]);
  res.json({ ok: true });
});

// ---- Utišavanja: koga sam ja utišao ----
router.get('/mutes', async (req, res) => {
  const rows = await q('SELECT muted_user_id FROM notification_mutes WHERE user_id = $1', [req.user.id]);
  res.json(rows.map((r) => r.muted_user_id));
});

// ---- Uključi/isključi obavijesti od pojedinog korisnika ----
router.put('/mutes/:userId', async (req, res) => {
  const target = Number(req.params.userId);
  const { muted } = req.body || {};
  if (target === req.user.id) return res.status(400).json({ error: 'Ne možete utišati sami sebe.' });
  if (muted) {
    await q(
      `INSERT INTO notification_mutes (user_id, muted_user_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [req.user.id, target]
    );
  } else {
    await q('DELETE FROM notification_mutes WHERE user_id = $1 AND muted_user_id = $2', [req.user.id, target]);
  }
  res.json({ ok: true });
});

export default router;
