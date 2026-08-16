import { Router } from 'express';
import { q, one } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { notify, userIds } from '../notify.js';

const router = Router();
router.use(requireAuth);

const SERVICE_LABEL = {
  ulje: 'Izmjena ulja',
  registracija: 'Registracija',
  tehnicki: 'Periodični tehnički pregled',
};
// Samo izmjena ulja je javna; registracija i tehnički su privatni (admin).
const PUBLIC_SERVICE = ['ulje'];

/** Status vozila je izveden: 'u_kvaru' dok postoji ijedan neriješen kvar. */
async function syncStatus(vehicleId) {
  return one(
    `UPDATE vehicles v
     SET status = CASE WHEN EXISTS (
           SELECT 1 FROM vehicle_faults f WHERE f.vehicle_id = v.id AND f.resolved = FALSE
         ) THEN 'u_kvaru' ELSE 'ispravno' END,
         updated_at = now()
     WHERE v.id = $1 RETURNING *`,
    [vehicleId]
  );
}

/** Kilometraža: null kad nije upisana, false kad nije valjan broj. */
function toKm(value) {
  if (value === null || value === undefined || value === '') return null;
  const km = Number(value);
  if (!Number.isInteger(km) || km < 0) return false;
  return km;
}

/** Datumi registracije/tehničkog vidljivi su samo administratoru. */
function stripPrivate(vehicle, isAdmin) {
  if (isAdmin) return vehicle;
  const { registration_until, inspection_until, ...rest } = vehicle;
  return rest;
}

// ---- Lista vozila (svi prijavljeni) ----
router.get('/vehicles', async (req, res) => {
  const rows = await q(
    `SELECT v.*,
            (SELECT count(*)::int FROM vehicle_faults f
              WHERE f.vehicle_id = v.id AND f.resolved = FALSE) AS open_faults,
            oil.done_date     AS last_oil_date,
            oil.odometer      AS last_oil_odometer,
            oil.next_odometer AS next_oil_odometer,
            reg.valid_until AS registration_until,
            teh.valid_until AS inspection_until
       FROM vehicles v
       LEFT JOIN LATERAL (
         SELECT r.done_date, r.odometer, r.next_odometer FROM vehicle_service_records r
          WHERE r.vehicle_id = v.id AND r.type = 'ulje'
          ORDER BY r.done_date DESC, r.id DESC LIMIT 1
       ) oil ON TRUE
       LEFT JOIN LATERAL (
         SELECT r.valid_until FROM vehicle_service_records r
          WHERE r.vehicle_id = v.id AND r.type = 'registracija'
          ORDER BY r.done_date DESC, r.id DESC LIMIT 1
       ) reg ON TRUE
       LEFT JOIN LATERAL (
         SELECT r.valid_until FROM vehicle_service_records r
          WHERE r.vehicle_id = v.id AND r.type = 'tehnicki'
          ORDER BY r.done_date DESC, r.id DESC LIMIT 1
       ) teh ON TRUE
      ORDER BY v.active DESC, v.registration`
  );
  const isAdmin = req.user.role === 'admin';
  res.json(rows.map((v) => stripPrivate(v, isAdmin)));
});

// ---- Detalji vozila: kvarovi + servisna povijest ----
router.get('/vehicles/:id', async (req, res) => {
  const id = Number(req.params.id);
  const isAdmin = req.user.role === 'admin';
  const vehicle = await one(
    `SELECT v.*,
            reg.valid_until AS registration_until,
            teh.valid_until AS inspection_until
       FROM vehicles v
       LEFT JOIN LATERAL (
         SELECT r.valid_until FROM vehicle_service_records r
          WHERE r.vehicle_id = v.id AND r.type = 'registracija'
          ORDER BY r.done_date DESC, r.id DESC LIMIT 1
       ) reg ON TRUE
       LEFT JOIN LATERAL (
         SELECT r.valid_until FROM vehicle_service_records r
          WHERE r.vehicle_id = v.id AND r.type = 'tehnicki'
          ORDER BY r.done_date DESC, r.id DESC LIMIT 1
       ) teh ON TRUE
      WHERE v.id = $1`,
    [id]
  );
  if (!vehicle) return res.status(404).json({ error: 'Vozilo ne postoji.' });

  const faults = await q(
    `SELECT f.*, u.full_name AS reporter_name, r.full_name AS resolver_name
       FROM vehicle_faults f
       JOIN users u ON u.id = f.reported_by
       LEFT JOIN users r ON r.id = f.resolved_by
      WHERE f.vehicle_id = $1
      ORDER BY f.resolved, f.created_at DESC`,
    [id]
  );

  // Neadministratori vide samo javne tipove zapisa (ulje).
  const service = await q(
    `SELECT s.*, u.full_name AS created_by_name
       FROM vehicle_service_records s
       JOIN users u ON u.id = s.created_by
      WHERE s.vehicle_id = $1 AND ($2::boolean OR s.type = ANY($3::text[]))
      ORDER BY s.done_date DESC, s.id DESC`,
    [id, isAdmin, PUBLIC_SERVICE]
  );

  res.json({ ...stripPrivate(vehicle, isAdmin), faults, service });
});

// ---- Novo vozilo (admin) ----
router.post('/vehicles', requireAdmin, async (req, res) => {
  const { registration, name = '' } = req.body || {};
  if (!registration?.trim()) return res.status(400).json({ error: 'Registracija je obavezna.' });
  const exists = await one('SELECT id FROM vehicles WHERE lower(registration) = lower($1)', [registration.trim()]);
  if (exists) return res.status(409).json({ error: 'Vozilo s tom registracijom već postoji.' });
  const vehicle = await one(
    `INSERT INTO vehicles (registration, name) VALUES ($1,$2) RETURNING *`,
    [registration.trim(), name.trim()]
  );
  res.status(201).json(vehicle);
});

// ---- Uređivanje vozila (admin): registracija, ime, napomena, aktivnost ----
// Status se ne postavlja ručno — izvodi se iz otvorenih kvarova.
router.put('/vehicles/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const vehicle = await one('SELECT * FROM vehicles WHERE id = $1', [id]);
  if (!vehicle) return res.status(404).json({ error: 'Vozilo ne postoji.' });
  const { registration, name, note, active } = req.body || {};
  if (registration?.trim()) {
    const clash = await one('SELECT id FROM vehicles WHERE lower(registration) = lower($1) AND id <> $2', [
      registration.trim(),
      id,
    ]);
    if (clash) return res.status(409).json({ error: 'Vozilo s tom registracijom već postoji.' });
  }
  const updated = await one(
    `UPDATE vehicles SET registration=$1, name=$2, note=$3, active=$4, updated_at=now()
     WHERE id=$5 RETURNING *`,
    [
      registration?.trim() || vehicle.registration,
      name ?? vehicle.name,
      note ?? vehicle.note,
      typeof active === 'boolean' ? active : vehicle.active,
      id,
    ]
  );
  res.json(updated);
});

// ---- Brisanje vozila (admin) ----
router.delete('/vehicles/:id', requireAdmin, async (req, res) => {
  await q('DELETE FROM vehicles WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

// =====================================================
// KVAROVI — prijaviti može bilo koja uloga, više njih istovremeno
// =====================================================
router.post('/vehicles/:id/faults', async (req, res) => {
  const id = Number(req.params.id);
  const { description = '' } = req.body || {};
  if (!description.trim()) return res.status(400).json({ error: 'Opis kvara je obavezan.' });
  const vehicle = await one('SELECT * FROM vehicles WHERE id = $1', [id]);
  if (!vehicle) return res.status(404).json({ error: 'Vozilo ne postoji.' });

  const fault = await one(
    `INSERT INTO vehicle_faults (vehicle_id, reported_by, description) VALUES ($1,$2,$3) RETURNING *`,
    [id, req.user.id, description.trim()]
  );
  await syncStatus(id);
  await notify({
    recipients: await userIds(['admin']),
    actorId: req.user.id,
    type: 'vozilo_kvar',
    title: `⚠ Kvar: ${vehicle.registration}`,
    body: `${req.user.full_name} — ${description.trim()}`,
    refType: null,
    refId: null,
  });
  res.status(201).json(fault);
});

// ---- Kvar riješen (admin) ----
router.put('/vehicles/:id/faults/:faultId/resolve', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const faultId = Number(req.params.faultId);
  const { note = '' } = req.body || {};
  const fault = await one('SELECT * FROM vehicle_faults WHERE id = $1 AND vehicle_id = $2', [faultId, id]);
  if (!fault) return res.status(404).json({ error: 'Kvar ne postoji.' });
  if (fault.resolved) return res.status(409).json({ error: 'Kvar je već označen kao riješen.' });

  const updated = await one(
    `UPDATE vehicle_faults SET resolved = TRUE, resolved_by = $1, resolved_at = now(), resolve_note = $2
     WHERE id = $3 RETURNING *`,
    [req.user.id, note.trim(), faultId]
  );
  const vehicle = await syncStatus(id);
  await notify({
    recipients: [fault.reported_by],
    actorId: req.user.id,
    type: 'vozilo_kvar',
    title: `✔ Riješen kvar: ${vehicle.registration}`,
    body: `${req.user.full_name} — ${fault.description}${note.trim() ? ' · ' + note.trim() : ''}`,
    refType: null,
    refId: null,
  });
  res.json(updated);
});

// ---- Brisanje prijave kvara (admin) ----
router.delete('/vehicles/:id/faults/:faultId', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await q('DELETE FROM vehicle_faults WHERE id = $1 AND vehicle_id = $2', [Number(req.params.faultId), id]);
  await syncStatus(id);
  res.json({ ok: true });
});

// =====================================================
// SERVISNA POVIJEST — unosi i briše samo administrator
// =====================================================
router.post('/vehicles/:id/service', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { type, done_date, valid_until = null, odometer = null, next_odometer = null, note = '' } = req.body || {};
  if (!SERVICE_LABEL[type]) return res.status(400).json({ error: 'Nepoznata vrsta zapisa.' });
  if (!done_date) return res.status(400).json({ error: 'Datum je obavezan.' });
  const vehicle = await one('SELECT id FROM vehicles WHERE id = $1', [id]);
  if (!vehicle) return res.status(404).json({ error: 'Vozilo ne postoji.' });

  const km = toKm(odometer);
  if (km === false) return res.status(400).json({ error: 'Kilometraža mora biti broj.' });
  // Iduća izmjena ima smisla samo uz izmjenu ulja
  const nextKm = type === 'ulje' ? toKm(next_odometer) : null;
  if (nextKm === false) return res.status(400).json({ error: 'Kilometraža iduće izmjene mora biti broj.' });
  if (km !== null && nextKm !== null && nextKm <= km) {
    return res.status(400).json({ error: 'Iduća izmjena mora biti na većoj kilometraži od trenutne.' });
  }

  const record = await one(
    `INSERT INTO vehicle_service_records (vehicle_id, type, done_date, valid_until, odometer, next_odometer, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [id, type, done_date, valid_until || null, km, nextKm, note.trim(), req.user.id]
  );
  await q('UPDATE vehicles SET updated_at = now() WHERE id = $1', [id]);
  res.status(201).json(record);
});

router.delete('/vehicles/:id/service/:recordId', requireAdmin, async (req, res) => {
  await q('DELETE FROM vehicle_service_records WHERE id = $1 AND vehicle_id = $2', [
    Number(req.params.recordId),
    Number(req.params.id),
  ]);
  res.json({ ok: true });
});

export default router;
