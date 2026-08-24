import { Router } from 'express';
import { q, one } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { notify } from '../notify.js';

const router = Router();
router.use(requireAuth);

/** Broj iz query stringa; null kad nije poslan ili nije valjan. */
function toId(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Datum iz query stringa (YYYY-MM-DD); null kad nije valjan. */
function toDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** Artikli grupirani po evidenciji. */
async function itemsByEntry(entryIds) {
  if (entryIds.length === 0) return new Map();
  const rows = await q(
    `SELECT i.*, u.full_name AS done_by_name
       FROM painting_items i
       LEFT JOIN users u ON u.id = i.done_by
      WHERE i.entry_id = ANY($1::int[])
      ORDER BY i.sort_order, i.id`,
    [entryIds]
  );
  const map = new Map();
  for (const it of rows) {
    if (!map.has(it.entry_id)) map.set(it.entry_id, []);
    map.get(it.entry_id).push(it);
  }
  return map;
}

// =====================================================
// MJESTA FARBANJA — dodaje administrator
// =====================================================
router.get('/painting/locations', async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const rows = await q(
    `SELECT l.*, (SELECT count(*)::int FROM painting_entries e WHERE e.location_id = l.id) AS entry_count
       FROM painting_locations l
      WHERE l.active = TRUE OR $1::boolean
      ORDER BY l.active DESC, l.name`,
    [isAdmin]
  );
  res.json(rows);
});

router.post('/painting/locations', requireAdmin, async (req, res) => {
  const { name = '' } = req.body || {};
  if (!name.trim()) return res.status(400).json({ error: 'Naziv mjesta je obavezan.' });
  const exists = await one('SELECT id FROM painting_locations WHERE lower(name) = lower($1)', [name.trim()]);
  if (exists) return res.status(409).json({ error: 'To mjesto farbanja već postoji.' });
  const row = await one('INSERT INTO painting_locations (name) VALUES ($1) RETURNING *', [name.trim()]);
  res.status(201).json(row);
});

router.put('/painting/locations/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const loc = await one('SELECT * FROM painting_locations WHERE id = $1', [id]);
  if (!loc) return res.status(404).json({ error: 'Mjesto farbanja ne postoji.' });
  const { name, active } = req.body || {};
  if (name?.trim()) {
    const clash = await one('SELECT id FROM painting_locations WHERE lower(name) = lower($1) AND id <> $2', [
      name.trim(),
      id,
    ]);
    if (clash) return res.status(409).json({ error: 'To mjesto farbanja već postoji.' });
  }
  const row = await one('UPDATE painting_locations SET name = $1, active = $2 WHERE id = $3 RETURNING *', [
    name?.trim() || loc.name,
    typeof active === 'boolean' ? active : loc.active,
    id,
  ]);
  res.json(row);
});

// Mjesto s evidencijama se ne briše — deaktivira se da povijest ostane čitljiva.
router.delete('/painting/locations/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const used = await one('SELECT count(*)::int AS n FROM painting_entries WHERE location_id = $1', [id]);
  if (used.n > 0) {
    const row = await one('UPDATE painting_locations SET active = FALSE WHERE id = $1 RETURNING *', [id]);
    return res.json({ ok: true, deactivated: true, location: row });
  }
  await q('DELETE FROM painting_locations WHERE id = $1', [id]);
  res.json({ ok: true, deactivated: false });
});

// =====================================================
// EVIDENCIJA FARBANJA
// Pretraga: ?from=&to=&location_id=&driver_id=&q=<naziv artikla>
// =====================================================
router.get('/painting', async (req, res) => {
  const from = toDate(req.query.from);
  const to = toDate(req.query.to);
  const locationId = toId(req.query.location_id);
  const driverId = toId(req.query.driver_id);
  const search = String(req.query.q || '').trim();

  const entries = await q(
    `SELECT e.*, l.name AS location_name, d.full_name AS driver_name, c.full_name AS created_by_name,
            (SELECT count(*)::int FROM painting_items i WHERE i.entry_id = e.id) AS item_count,
            (SELECT count(*)::int FROM painting_items i WHERE i.entry_id = e.id AND i.done) AS done_count
       FROM painting_entries e
       JOIN painting_locations l ON l.id = e.location_id
       JOIN users c ON c.id = e.created_by
       LEFT JOIN users d ON d.id = e.driver_id
      WHERE ($1::date IS NULL OR e.entry_date >= $1::date)
        AND ($2::date IS NULL OR e.entry_date <= $2::date)
        AND ($3::int  IS NULL OR e.location_id = $3::int)
        AND ($4::int  IS NULL OR e.driver_id = $4::int)
        AND ($5::text = '' OR EXISTS (
              SELECT 1 FROM painting_items i
               WHERE i.entry_id = e.id AND i.name ILIKE '%' || $5::text || '%'))
      ORDER BY e.entry_date DESC, e.id DESC`,
    [from, to, locationId, driverId, search]
  );

  const map = await itemsByEntry(entries.map((e) => e.id));
  res.json(entries.map((e) => ({ ...e, items: map.get(e.id) || [] })));
});

router.get('/painting/:id', async (req, res) => {
  const id = Number(req.params.id);
  const entry = await one(
    `SELECT e.*, l.name AS location_name, d.full_name AS driver_name, c.full_name AS created_by_name
       FROM painting_entries e
       JOIN painting_locations l ON l.id = e.location_id
       JOIN users c ON c.id = e.created_by
       LEFT JOIN users d ON d.id = e.driver_id
      WHERE e.id = $1`,
    [id]
  );
  if (!entry) return res.status(404).json({ error: 'Evidencija ne postoji.' });
  const map = await itemsByEntry([id]);
  res.json({ ...entry, items: map.get(id) || [] });
});

// ---- Nova evidencija (admin) ----
router.post('/painting', requireAdmin, async (req, res) => {
  const { entry_date, driver_id = null, location_id, note = '', items = [] } = req.body || {};
  if (!toDate(entry_date)) return res.status(400).json({ error: 'Datum je obavezan.' });

  const locId = toId(location_id);
  if (!locId) return res.status(400).json({ error: 'Mjesto farbanja je obavezno.' });
  const location = await one('SELECT * FROM painting_locations WHERE id = $1', [locId]);
  if (!location) return res.status(404).json({ error: 'Mjesto farbanja ne postoji.' });

  const drvId = toId(driver_id);
  if (drvId) {
    const driver = await one('SELECT id FROM users WHERE id = $1', [drvId]);
    if (!driver) return res.status(404).json({ error: 'Odabrani vozač ne postoji.' });
  }

  const names = (Array.isArray(items) ? items : [])
    .map((it) => String(typeof it === 'string' ? it : it?.name || '').trim())
    .filter(Boolean);
  if (names.length === 0) return res.status(400).json({ error: 'Dodajte barem jedan artikl za farbanje.' });

  const entry = await one(
    `INSERT INTO painting_entries (entry_date, driver_id, location_id, note, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [entry_date, drvId, locId, String(note).trim(), req.user.id]
  );

  for (const [i, name] of names.entries()) {
    await q('INSERT INTO painting_items (entry_id, name, sort_order) VALUES ($1,$2,$3)', [entry.id, name, i]);
  }

  if (drvId) {
    await notify({
      recipients: [drvId],
      actorId: req.user.id,
      type: 'farbanje',
      title: `🎨 Farbanje: ${location.name}`,
      body: `${names.length} ${names.length === 1 ? 'artikl' : 'artikala'} — ${new Date(entry.entry_date).toLocaleDateString('hr-HR')}`,
      refType: null,
      refId: null,
    });
  }

  const map = await itemsByEntry([entry.id]);
  res.status(201).json({ ...entry, location_name: location.name, items: map.get(entry.id) || [] });
});

// ---- Uređivanje zaglavlja evidencije (admin) ----
router.put('/painting/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const entry = await one('SELECT * FROM painting_entries WHERE id = $1', [id]);
  if (!entry) return res.status(404).json({ error: 'Evidencija ne postoji.' });

  const { entry_date, driver_id, location_id, note } = req.body || {};
  if (entry_date !== undefined && !toDate(entry_date)) return res.status(400).json({ error: 'Neispravan datum.' });

  let locId = entry.location_id;
  if (location_id !== undefined) {
    locId = toId(location_id);
    if (!locId) return res.status(400).json({ error: 'Mjesto farbanja je obavezno.' });
    const location = await one('SELECT id FROM painting_locations WHERE id = $1', [locId]);
    if (!location) return res.status(404).json({ error: 'Mjesto farbanja ne postoji.' });
  }

  const drvId = driver_id === undefined ? entry.driver_id : toId(driver_id);

  const updated = await one(
    `UPDATE painting_entries SET entry_date = $1, driver_id = $2, location_id = $3, note = $4, updated_at = now()
     WHERE id = $5 RETURNING *`,
    [entry_date || entry.entry_date, drvId, locId, note === undefined ? entry.note : String(note).trim(), id]
  );
  res.json(updated);
});

router.delete('/painting/:id', requireAdmin, async (req, res) => {
  await q('DELETE FROM painting_entries WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

// ---- Dodavanje artikla u postojeću evidenciju (admin) ----
router.post('/painting/:id/items', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { name = '' } = req.body || {};
  if (!String(name).trim()) return res.status(400).json({ error: 'Naziv artikla je obavezan.' });
  const entry = await one('SELECT id FROM painting_entries WHERE id = $1', [id]);
  if (!entry) return res.status(404).json({ error: 'Evidencija ne postoji.' });

  const last = await one('SELECT COALESCE(max(sort_order), -1) AS p FROM painting_items WHERE entry_id = $1', [id]);
  const item = await one(
    'INSERT INTO painting_items (entry_id, name, sort_order) VALUES ($1,$2,$3) RETURNING *',
    [id, String(name).trim(), last.p + 1]
  );
  await q('UPDATE painting_entries SET updated_at = now() WHERE id = $1', [id]);
  res.status(201).json(item);
});

// ---- Kvačica "ofarbano" — administrator ili vozač s te evidencije ----
router.put('/painting/items/:itemId', async (req, res) => {
  const itemId = Number(req.params.itemId);
  const item = await one(
    `SELECT i.*, e.driver_id FROM painting_items i JOIN painting_entries e ON e.id = i.entry_id WHERE i.id = $1`,
    [itemId]
  );
  if (!item) return res.status(404).json({ error: 'Artikl ne postoji.' });

  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && item.driver_id !== req.user.id) {
    return res.status(403).json({ error: 'Označiti mogu administrator i vozač s te evidencije.' });
  }

  const { done, name } = req.body || {};
  // Preimenovati artikl smije samo administrator
  if (name !== undefined && !isAdmin) {
    return res.status(403).json({ error: 'Samo administrator može preimenovati artikl.' });
  }
  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: 'Naziv artikla je obavezan.' });
  }

  const nextDone = typeof done === 'boolean' ? done : item.done;
  const updated = await one(
    `UPDATE painting_items
        SET name = $1,
            done = $2::boolean,
            done_by = CASE WHEN $2::boolean THEN $3::int ELSE NULL END,
            done_at = CASE WHEN $2::boolean THEN COALESCE(done_at, now()) ELSE NULL END
      WHERE id = $4 RETURNING *`,
    [name === undefined ? item.name : String(name).trim(), nextDone, req.user.id, itemId]
  );
  await q('UPDATE painting_entries SET updated_at = now() WHERE id = $1', [item.entry_id]);
  res.json(updated);
});

router.delete('/painting/items/:itemId', requireAdmin, async (req, res) => {
  await q('DELETE FROM painting_items WHERE id = $1', [Number(req.params.itemId)]);
  res.json({ ok: true });
});

export default router;
