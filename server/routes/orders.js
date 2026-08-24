import { Router } from 'express';
import { q, one } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';

const router = Router();
// Narudžbe i dobavljači su u cijelosti administratorski dio aplikacije.
router.use(requireAuth, requireAdmin);

function toId(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** Artikli grupirani po narudžbi. */
async function itemsByOrder(orderIds) {
  if (orderIds.length === 0) return new Map();
  const rows = await q(
    `SELECT i.*, u.full_name AS done_by_name
       FROM order_items i
       LEFT JOIN users u ON u.id = i.done_by
      WHERE i.order_id = ANY($1::int[])
      ORDER BY i.sort_order, i.id`,
    [orderIds]
  );
  const map = new Map();
  for (const it of rows) {
    if (!map.has(it.order_id)) map.set(it.order_id, []);
    map.get(it.order_id).push(it);
  }
  return map;
}

// =====================================================
// DOBAVLJAČI — kartice na ulazu u Narudžbe
// =====================================================
router.get('/suppliers', async (_req, res) => {
  const rows = await q(
    `SELECT s.*,
            (SELECT count(*)::int FROM orders o WHERE o.supplier_id = s.id) AS order_count,
            (SELECT count(*)::int FROM order_items i
               JOIN orders o ON o.id = i.order_id
              WHERE o.supplier_id = s.id AND i.done = FALSE) AS open_items,
            (SELECT max(o.order_date) FROM orders o WHERE o.supplier_id = s.id) AS last_order_date
       FROM suppliers s
      ORDER BY s.active DESC, s.name`
  );
  res.json(rows);
});

router.get('/suppliers/:id', async (req, res) => {
  const supplier = await one('SELECT * FROM suppliers WHERE id = $1', [Number(req.params.id)]);
  if (!supplier) return res.status(404).json({ error: 'Dobavljač ne postoji.' });
  res.json(supplier);
});

router.post('/suppliers', async (req, res) => {
  const { name = '', note = '' } = req.body || {};
  if (!name.trim()) return res.status(400).json({ error: 'Naziv dobavljača je obavezan.' });
  const exists = await one('SELECT id FROM suppliers WHERE lower(name) = lower($1)', [name.trim()]);
  if (exists) return res.status(409).json({ error: 'Dobavljač s tim nazivom već postoji.' });
  const supplier = await one('INSERT INTO suppliers (name, note) VALUES ($1,$2) RETURNING *', [
    name.trim(),
    String(note).trim(),
  ]);
  res.status(201).json(supplier);
});

router.put('/suppliers/:id', async (req, res) => {
  const id = Number(req.params.id);
  const supplier = await one('SELECT * FROM suppliers WHERE id = $1', [id]);
  if (!supplier) return res.status(404).json({ error: 'Dobavljač ne postoji.' });
  const { name, note, active } = req.body || {};
  if (name?.trim()) {
    const clash = await one('SELECT id FROM suppliers WHERE lower(name) = lower($1) AND id <> $2', [name.trim(), id]);
    if (clash) return res.status(409).json({ error: 'Dobavljač s tim nazivom već postoji.' });
  }
  const updated = await one('UPDATE suppliers SET name = $1, note = $2, active = $3 WHERE id = $4 RETURNING *', [
    name?.trim() || supplier.name,
    note === undefined ? supplier.note : String(note).trim(),
    typeof active === 'boolean' ? active : supplier.active,
    id,
  ]);
  res.json(updated);
});

// Briše dobavljača zajedno sa svim njegovim narudžbama (ON DELETE CASCADE).
router.delete('/suppliers/:id', async (req, res) => {
  await q('DELETE FROM suppliers WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

// =====================================================
// NARUDŽBE
// Pretraga: ?supplier_id=&q=<naziv artikla>&from=&to=
// =====================================================
router.get('/orders', async (req, res) => {
  const supplierId = toId(req.query.supplier_id);
  const from = toDate(req.query.from);
  const to = toDate(req.query.to);
  const search = String(req.query.q || '').trim();

  const orders = await q(
    `SELECT o.*, s.name AS supplier_name, u.full_name AS created_by_name,
            (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS item_count,
            (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id AND i.done) AS done_count
       FROM orders o
       JOIN suppliers s ON s.id = o.supplier_id
       JOIN users u ON u.id = o.created_by
      WHERE ($1::int  IS NULL OR o.supplier_id = $1::int)
        AND ($2::date IS NULL OR o.order_date >= $2::date)
        AND ($3::date IS NULL OR o.order_date <= $3::date)
        AND ($4::text = '' OR EXISTS (
              SELECT 1 FROM order_items i
               WHERE i.order_id = o.id AND i.name ILIKE '%' || $4::text || '%'))
      ORDER BY o.order_date DESC, o.id DESC`,
    [supplierId, from, to, search]
  );

  const map = await itemsByOrder(orders.map((o) => o.id));
  res.json(orders.map((o) => ({ ...o, items: map.get(o.id) || [] })));
});

// ---- Nova narudžba kod dobavljača ----
router.post('/suppliers/:id/orders', async (req, res) => {
  const supplierId = Number(req.params.id);
  const supplier = await one('SELECT * FROM suppliers WHERE id = $1', [supplierId]);
  if (!supplier) return res.status(404).json({ error: 'Dobavljač ne postoji.' });

  const { order_date, due_date = null, note = '', items = [] } = req.body || {};
  if (!toDate(order_date)) return res.status(400).json({ error: 'Datum narudžbe je obavezan.' });
  if (due_date && !toDate(due_date)) return res.status(400).json({ error: 'Neispravan rok isporuke.' });

  const lines = (Array.isArray(items) ? items : [])
    .map((it) => ({
      name: String(it?.name || '').trim(),
      quantity: String(it?.quantity ?? '').trim(),
    }))
    .filter((it) => it.name);
  if (lines.length === 0) return res.status(400).json({ error: 'Dodajte barem jedan artikl.' });

  const order = await one(
    `INSERT INTO orders (supplier_id, order_date, due_date, note, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [supplierId, order_date, due_date || null, String(note).trim(), req.user.id]
  );
  for (const [i, line] of lines.entries()) {
    await q('INSERT INTO order_items (order_id, name, quantity, sort_order) VALUES ($1,$2,$3,$4)', [
      order.id,
      line.name,
      line.quantity,
      i,
    ]);
  }

  const map = await itemsByOrder([order.id]);
  res.status(201).json({ ...order, supplier_name: supplier.name, items: map.get(order.id) || [] });
});

router.put('/orders/:id', async (req, res) => {
  const id = Number(req.params.id);
  const order = await one('SELECT * FROM orders WHERE id = $1', [id]);
  if (!order) return res.status(404).json({ error: 'Narudžba ne postoji.' });

  const { order_date, due_date, note } = req.body || {};
  if (order_date !== undefined && !toDate(order_date)) return res.status(400).json({ error: 'Neispravan datum.' });
  if (due_date !== undefined && due_date !== null && due_date !== '' && !toDate(due_date)) {
    return res.status(400).json({ error: 'Neispravan rok isporuke.' });
  }

  const updated = await one(
    `UPDATE orders SET order_date = $1, due_date = $2, note = $3, updated_at = now()
     WHERE id = $4 RETURNING *`,
    [
      order_date || order.order_date,
      due_date === undefined ? order.due_date : due_date || null,
      note === undefined ? order.note : String(note).trim(),
      id,
    ]
  );
  res.json(updated);
});

router.delete('/orders/:id', async (req, res) => {
  await q('DELETE FROM orders WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

// ---- Artikli narudžbe ----
router.post('/orders/:id/items', async (req, res) => {
  const id = Number(req.params.id);
  const { name = '', quantity = '' } = req.body || {};
  if (!String(name).trim()) return res.status(400).json({ error: 'Naziv artikla je obavezan.' });
  const order = await one('SELECT id FROM orders WHERE id = $1', [id]);
  if (!order) return res.status(404).json({ error: 'Narudžba ne postoji.' });

  const last = await one('SELECT COALESCE(max(sort_order), -1) AS p FROM order_items WHERE order_id = $1', [id]);
  const item = await one(
    'INSERT INTO order_items (order_id, name, quantity, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
    [id, String(name).trim(), String(quantity).trim(), last.p + 1]
  );
  await q('UPDATE orders SET updated_at = now() WHERE id = $1', [id]);
  res.status(201).json(item);
});

// Kvačica "zaprimljeno" (zeleno) + uređivanje naziva/količine
router.put('/orders/items/:itemId', async (req, res) => {
  const itemId = Number(req.params.itemId);
  const item = await one('SELECT * FROM order_items WHERE id = $1', [itemId]);
  if (!item) return res.status(404).json({ error: 'Artikl ne postoji.' });

  const { done, name, quantity } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Naziv artikla je obavezan.' });

  const nextDone = typeof done === 'boolean' ? done : item.done;
  const updated = await one(
    `UPDATE order_items
        SET name = $1,
            quantity = $2,
            done = $3::boolean,
            done_by = CASE WHEN $3::boolean THEN $4::int ELSE NULL END,
            done_at = CASE WHEN $3::boolean THEN COALESCE(done_at, now()) ELSE NULL END
      WHERE id = $5 RETURNING *`,
    [
      name === undefined ? item.name : String(name).trim(),
      quantity === undefined ? item.quantity : String(quantity).trim(),
      nextDone,
      req.user.id,
      itemId,
    ]
  );
  await q('UPDATE orders SET updated_at = now() WHERE id = $1', [item.order_id]);
  res.json(updated);
});

router.delete('/orders/items/:itemId', async (req, res) => {
  await q('DELETE FROM order_items WHERE id = $1', [Number(req.params.itemId)]);
  res.json({ ok: true });
});

export default router;
