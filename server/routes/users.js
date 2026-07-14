import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q, one } from '../db.js';
import { signToken, requireAuth, requireAdmin } from '../auth.js';

const router = Router();

// ---- Prijava ----
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Unesite korisničko ime i lozinku.' });
  const user = await one('SELECT * FROM users WHERE lower(username) = lower($1)', [username.trim()]);
  if (!user || !user.active) return res.status(401).json({ error: 'Pogrešno korisničko ime ili lozinka.' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Pogrešno korisničko ime ili lozinka.' });
  res.json({
    token: signToken(user),
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
  });
});

// ---- Trenutni korisnik ----
router.get('/me', requireAuth, (req, res) => res.json(req.user));

// ---- Lista korisnika (svi prijavljeni — treba za dodjelu zadataka i mute postavke) ----
router.get('/users', requireAuth, async (req, res) => {
  const rows = await q(
    'SELECT id, username, full_name, role, active FROM users ORDER BY role, full_name'
  );
  res.json(rows);
});

// ---- Kreiranje korisnika (admin) ----
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, full_name, role } = req.body || {};
  if (!username || !password || !full_name || !role)
    return res.status(400).json({ error: 'Sva polja su obavezna.' });
  if (!['admin', 'majstor', 'vozac'].includes(role))
    return res.status(400).json({ error: 'Nepoznata uloga.' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Lozinka mora imati barem 4 znaka.' });
  const exists = await one('SELECT id FROM users WHERE lower(username) = lower($1)', [username.trim()]);
  if (exists) return res.status(409).json({ error: 'Korisničko ime već postoji.' });
  const hash = await bcrypt.hash(password, 10);
  const user = await one(
    `INSERT INTO users (username, password_hash, full_name, role)
     VALUES ($1,$2,$3,$4) RETURNING id, username, full_name, role, active`,
    [username.trim(), hash, full_name.trim(), role]
  );
  res.status(201).json(user);
});

// ---- Uređivanje korisnika (admin): ime, uloga, aktivnost, nova lozinka ----
router.put('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { full_name, role, active, password } = req.body || {};
  const user = await one('SELECT * FROM users WHERE id = $1', [id]);
  if (!user) return res.status(404).json({ error: 'Korisnik ne postoji.' });
  const hash = password ? await bcrypt.hash(password, 10) : user.password_hash;
  const updated = await one(
    `UPDATE users SET full_name = $1, role = $2, active = $3, password_hash = $4
     WHERE id = $5 RETURNING id, username, full_name, role, active`,
    [
      full_name ?? user.full_name,
      role ?? user.role,
      typeof active === 'boolean' ? active : user.active,
      hash,
      id,
    ]
  );
  res.json(updated);
});

// ---- Promjena vlastite lozinke ----
router.put('/me/password', requireAuth, async (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password || new_password.length < 4)
    return res.status(400).json({ error: 'Nova lozinka mora imati barem 4 znaka.' });
  const user = await one('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const ok = await bcrypt.compare(old_password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Stara lozinka nije točna.' });
  const hash = await bcrypt.hash(new_password, 10);
  await q('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
  res.json({ ok: true });
});

export default router;
