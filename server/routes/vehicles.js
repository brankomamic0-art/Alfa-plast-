import { Router } from 'express';
import { q, one } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { notify, userIds } from '../notify.js';

const router = Router();
router.use(requireAuth);

const STATUS_LABEL = { ispravno: 'Ispravno', u_kvaru: 'U kvaru' };

// ---- Lista vozila (svi prijavljeni — vozači trebaju vidjeti dostupnost) ----
router.get('/vehicles', async (req, res) => {
  const rows = await q('SELECT * FROM vehicles ORDER BY active DESC, registration');
  res.json(rows);
});

// ---- Novo vozilo (admin) ----
router.post('/vehicles', requireAdmin, async (req, res) => {
  const { registration, name = '', status = 'ispravno' } = req.body || {};
  if (!registration?.trim()) return res.status(400).json({ error: 'Registracija je obavezna.' });
  if (!STATUS_LABEL[status]) return res.status(400).json({ error: 'Nepoznat status.' });
  const exists = await one('SELECT id FROM vehicles WHERE lower(registration) = lower($1)', [registration.trim()]);
  if (exists) return res.status(409).json({ error: 'Vozilo s tom registracijom već postoji.' });
  const vehicle = await one(
    `INSERT INTO vehicles (registration, name, status) VALUES ($1,$2,$3) RETURNING *`,
    [registration.trim(), name.trim(), status]
  );
  res.status(201).json(vehicle);
});

// ---- Uređivanje vozila (admin): registracija, ime, status, napomena, aktivnost ----
router.put('/vehicles/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const vehicle = await one('SELECT * FROM vehicles WHERE id = $1', [id]);
  if (!vehicle) return res.status(404).json({ error: 'Vozilo ne postoji.' });
  const { registration, name, status, note, active } = req.body || {};
  if (status !== undefined && !STATUS_LABEL[status]) return res.status(400).json({ error: 'Nepoznat status.' });
  const updated = await one(
    `UPDATE vehicles SET registration=$1, name=$2, status=$3, note=$4, active=$5, updated_at=now()
     WHERE id=$6 RETURNING *`,
    [
      registration?.trim() ?? vehicle.registration,
      name ?? vehicle.name,
      status ?? vehicle.status,
      note ?? vehicle.note,
      typeof active === 'boolean' ? active : vehicle.active,
      id,
    ]
  );
  res.json(updated);
});

// ---- Prijava kvara (vozač / bilo tko prijavljen) ----
router.post('/vehicles/:id/report-fault', async (req, res) => {
  const id = Number(req.params.id);
  const { comment = '' } = req.body || {};
  const vehicle = await one('SELECT * FROM vehicles WHERE id = $1', [id]);
  if (!vehicle) return res.status(404).json({ error: 'Vozilo ne postoji.' });
  const updated = await one(
    `UPDATE vehicles SET status = 'u_kvaru', note = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [comment.trim(), id]
  );
  await notify({
    recipients: await userIds(['admin']),
    actorId: req.user.id,
    type: 'vozilo_kvar',
    title: `⚠ Kvar: ${vehicle.registration}`,
    body: `${req.user.full_name}${comment ? ' — ' + comment.trim() : ''}`,
    refType: null,
    refId: null,
  });
  res.json(updated);
});

// ---- Brisanje vozila (admin) ----
router.delete('/vehicles/:id', requireAdmin, async (req, res) => {
  await q('DELETE FROM vehicles WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

export default router;
