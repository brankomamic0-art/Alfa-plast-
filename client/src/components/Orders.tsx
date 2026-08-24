import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Order, OrderItem, Supplier, daysUntil, fmtDate, fmtDateTime, toDateInput, todayInput } from '../types';
import { Modal, ErrorBox } from './ui';

/**
 * Narudžbe — isključivo administratorski dio (server odbija sve ostale uloge).
 * Ulaz su kartice dobavljača; klikom na karticu ulazi se u dobavljača
 * gdje se kreiraju narudžbe i označavaju zaprimljeni artikli.
 */
export default function Orders() {
  const [openSupplier, setOpenSupplier] = useState<number | null>(null);

  return openSupplier === null
    ? <SupplierList onOpen={setOpenSupplier} />
    : <SupplierDetail supplierId={openSupplier} onBack={() => setOpenSupplier(null)} />;
}

// =====================================================
// Kartice dobavljača + pretraga artikala kroz sve dobavljače
// =====================================================
function SupplierList({ onOpen }: { onOpen: (id: number) => void }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [results, setResults] = useState<Order[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setSuppliers(await api.get<Supplier[]>('/suppliers'));
      setError('');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  // Pretraga po artiklu kroz sve dobavljače
  useEffect(() => {
    const term = search.trim();
    if (!term) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        setResults(await api.get<Order[]>(`/orders?q=${encodeURIComponent(term)}`));
      } catch (e: any) { setError(e.message); }
    }, 300);
    return () => clearTimeout(t);
  }, [search, reloadKey]);

  const searching = !!search.trim();

  return (
    <div>
      <button className="btn btn-primary btn-block" onClick={() => setShowCreate(true)}>
        + Novi dobavljač
      </button>

      <div className="search-bar" style={{ marginTop: 12 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Pretraži artikle kod svih dobavljača…"
          style={{ flexBasis: '100%' }}
        />
      </div>

      <ErrorBox msg={error} />

      {searching ? (
        <>
          <div className="section-title">Rezultati pretrage</div>
          {results.length === 0 && <div className="empty">Nema artikala za "{search.trim()}".</div>}
          {results.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              highlight={search.trim()}
              showSupplier
              onChanged={() => setReloadKey((k) => k + 1)}
              onError={setError}
              onOpenSupplier={() => onOpen(o.supplier_id)}
            />
          ))}
        </>
      ) : (
        <>
          <div className="section-title">Dobavljači</div>
          {loading && <div className="muted">Učitavanje…</div>}
          {!loading && suppliers.length === 0 && <div className="empty">Nema dobavljača. Dodajte prvog.</div>}
          {suppliers.map((s) => (
            <div key={s.id} className="card clickable" onClick={() => onOpen(s.id)} role="button">
              <div className="spread">
                <div>
                  <h3>
                    {s.name}
                    {!s.active && <> <span className="badge b-gray">Neaktivan</span></>}
                  </h3>
                  <div className="muted">
                    {s.order_count ? `${s.order_count} ${orderWord(s.order_count)}` : 'Još nema narudžbi'}
                    {s.last_order_date && <> · zadnja {fmtDate(s.last_order_date)}</>}
                  </div>
                </div>
                <span className={`badge ${s.open_items ? 'b-amber' : 'b-green'}`}>
                  {s.open_items ? `${s.open_items} nezaprimljeno` : 'Sve zaprimljeno'}
                </span>
              </div>
              {s.note && <div className="muted" style={{ marginTop: 6 }}>{s.note}</div>}
            </div>
          ))}
        </>
      )}

      {showCreate && (
        <SupplierModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} />
      )}
    </div>
  );
}

/** 1 narudžba · 2-4 narudžbe · 5+ narudžbi */
function orderWord(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'narudžba';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'narudžbe';
  return 'narudžbi';
}

// =====================================================
// Kartica dobavljača — narudžbe + pretraga po artiklu
// =====================================================
function SupplierDetail({ supplierId, onBack }: { supplierId: number; onBack: () => void }) {
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editOrder, setEditOrder] = useState<Order | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ supplier_id: String(supplierId) });
    if (search.trim()) params.set('q', search.trim());
    try {
      const [s, o] = await Promise.all([
        api.get<Supplier>(`/suppliers/${supplierId}`),
        api.get<Order[]>(`/orders?${params.toString()}`),
      ]);
      setSupplier(s);
      setOrders(o);
      setError('');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [supplierId, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]);

  async function removeSupplier() {
    if (!supplier) return;
    if (!confirm(`Obrisati dobavljača "${supplier.name}"? Brišu se i sve njegove narudžbe.`)) return;
    try {
      await api.del(`/suppliers/${supplierId}`);
      onBack();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack}>← Svi dobavljači</button>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="spread">
          <div>
            <h3 style={{ fontSize: 19 }}>{supplier?.name || 'Dobavljač'}</h3>
            {supplier?.note && <div className="muted">{supplier.note}</div>}
          </div>
          {supplier && !supplier.active && <span className="badge b-gray">Neaktivan</span>}
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setShowCreate(true)}>
            + Nova narudžba
          </button>
          <button className="btn btn-ghost" onClick={() => setShowEdit(true)}>Uredi</button>
          <button className="btn btn-ghost" onClick={removeSupplier}>Obriši</button>
        </div>
      </div>

      <div className="search-bar">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Pretraži po artiklu…"
          style={{ flexBasis: '100%' }}
        />
      </div>

      <div className="section-title">Narudžbe {search.trim() && `(${orders.length})`}</div>

      <ErrorBox msg={error} />

      {loading && <div className="muted">Učitavanje…</div>}
      {!loading && orders.length === 0 && (
        <div className="empty">
          {search.trim() ? `Nema artikala za "${search.trim()}".` : 'Još nema narudžbi kod ovog dobavljača.'}
        </div>
      )}

      {orders.map((o) => (
        <OrderCard
          key={o.id}
          order={o}
          highlight={search.trim()}
          onChanged={load}
          onEdit={() => setEditOrder(o)}
          onError={setError}
        />
      ))}

      {showCreate && supplier && (
        <OrderModal
          supplier={supplier}
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); load(); }}
        />
      )}
      {editOrder && supplier && (
        <OrderModal
          supplier={supplier}
          order={editOrder}
          onClose={() => setEditOrder(null)}
          onDone={() => { setEditOrder(null); load(); }}
        />
      )}
      {showEdit && supplier && (
        <SupplierModal
          supplier={supplier}
          onClose={() => setShowEdit(false)}
          onDone={() => { setShowEdit(false); load(); }}
        />
      )}
    </div>
  );
}

// =====================================================
// Kartica narudžbe s kvačicama za artikle
// =====================================================
function OrderCard({ order, highlight, showSupplier, onChanged, onEdit, onError, onOpenSupplier }: {
  order: Order;
  highlight: string;
  showSupplier?: boolean;
  onChanged: () => void;
  onEdit?: () => void;
  onError: (msg: string) => void;
  onOpenSupplier?: () => void;
}) {
  const [items, setItems] = useState<OrderItem[]>(order.items);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => { setItems(order.items); }, [order.items]);

  const doneCount = items.filter((i) => i.done).length;
  const allDone = items.length > 0 && doneCount === items.length;
  const left = order.due_date ? daysUntil(order.due_date) : null;

  async function toggle(item: OrderItem) {
    setBusyId(item.id);
    try {
      const updated = await api.put<OrderItem>(`/orders/items/${item.id}`, { done: !item.done });
      setItems(items.map((i) => (i.id === item.id ? { ...i, ...updated } : i)));
      onChanged();
    } catch (e: any) { onError(e.message); }
    setBusyId(null);
  }

  async function addItem() {
    if (!newName.trim()) return;
    try {
      await api.post(`/orders/${order.id}/items`, { name: newName, quantity: newQty });
      setNewName('');
      setNewQty('');
      setAdding(false);
      onChanged();
    } catch (e: any) { onError(e.message); }
  }

  async function removeItem(item: OrderItem) {
    if (!confirm(`Obrisati artikl "${item.name}"?`)) return;
    try {
      await api.del(`/orders/items/${item.id}`);
      onChanged();
    } catch (e: any) { onError(e.message); }
  }

  async function removeOrder() {
    if (!confirm(`Obrisati narudžbu od ${fmtDate(order.order_date)}?`)) return;
    try {
      await api.del(`/orders/${order.id}`);
      onChanged();
    } catch (e: any) { onError(e.message); }
  }

  return (
    <div className="card">
      <div className="spread">
        <div>
          <h3>{fmtDate(order.order_date)}</h3>
          <div className="muted">
            {showSupplier && <>{order.supplier_name} · </>}
            Naručio {order.created_by_name}
          </div>
        </div>
        <span className={`badge ${allDone ? 'b-green' : 'b-amber'}`}>
          {doneCount}/{items.length} {allDone ? '✔' : ''}
        </span>
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        {order.due_date && (
          <span className={`badge ${allDone ? 'b-gray' : left! < 0 ? 'b-red' : left! <= 3 ? 'b-amber' : 'b-blue'}`}>
            📦 Rok isporuke: {fmtDate(order.due_date)}
            {!allDone && (left! < 0 ? ' · probijen' : left === 0 ? ' · danas' : left! <= 3 ? ` · još ${left} d` : '')}
          </span>
        )}
        {showSupplier && onOpenSupplier && (
          <button className="btn btn-sm btn-ghost" onClick={onOpenSupplier}>Otvori dobavljača →</button>
        )}
      </div>

      {order.note && <div className="muted" style={{ marginTop: 6 }}>{order.note}</div>}

      <div className="check-list">
        {items.map((it) => (
          <label key={it.id} className={`check-item${it.done ? ' done' : ''}`}>
            <input
              type="checkbox"
              checked={it.done}
              disabled={busyId === it.id}
              onChange={() => toggle(it)}
            />
            <span className="grow">
              <span className="nm">{mark(it.name, highlight)}</span>
              {it.quantity && <span className="qty">{it.quantity}</span>}
              {it.done && it.done_at && (
                <span className="rl"> Zaprimljeno {fmtDateTime(it.done_at)}{it.done_by_name ? ` · ${it.done_by_name}` : ''}</span>
              )}
            </span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={(ev) => { ev.preventDefault(); removeItem(it); }}
            >✕</button>
          </label>
        ))}
        {items.length === 0 && <div className="muted">Nema artikala.</div>}
      </div>

      {adding ? (
        <div className="btn-row">
          <input
            className="inline-input"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
            placeholder="Naziv artikla"
          />
          <input
            className="inline-input qty-input"
            value={newQty}
            onChange={(e) => setNewQty(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
            placeholder="Količina"
          />
          <button className="btn btn-sm btn-primary" onClick={addItem}>Dodaj</button>
          <button className="btn btn-sm btn-ghost" onClick={() => { setAdding(false); setNewName(''); setNewQty(''); }}>
            Odustani
          </button>
        </div>
      ) : (
        <div className="btn-row">
          <button className="btn btn-sm btn-ghost" onClick={() => setAdding(true)}>+ Artikl</button>
          {onEdit && <button className="btn btn-sm btn-ghost" onClick={onEdit}>Uredi</button>}
          <button className="btn btn-sm btn-ghost" onClick={removeOrder}>Obriši</button>
        </div>
      )}
    </div>
  );
}

/** Podebljava dio naziva koji odgovara pretrazi. */
function mark(text: string, needle: string) {
  const n = needle.trim();
  if (!n) return text;
  const i = text.toLowerCase().indexOf(n.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + n.length)}</mark>
      {text.slice(i + n.length)}
    </>
  );
}

// =====================================================
// Kreiranje / uređivanje narudžbe
// =====================================================
function OrderModal({ supplier, order, onClose, onDone }: {
  supplier: Supplier;
  order?: Order;
  onClose: () => void;
  onDone: () => void;
}) {
  const isEdit = !!order;
  const [date, setDate] = useState(order ? toDateInput(order.order_date) : todayInput());
  const [dueDate, setDueDate] = useState(order ? toDateInput(order.due_date) : '');
  const [note, setNote] = useState(order?.note || '');
  const [lines, setLines] = useState<{ name: string; quantity: string }[]>([{ name: '', quantity: '' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function setLine(i: number, patch: Partial<{ name: string; quantity: string }>) {
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit() {
    if (!date) { setError('Datum narudžbe je obavezan.'); return; }
    const items = lines.map((l) => ({ name: l.name.trim(), quantity: l.quantity.trim() })).filter((l) => l.name);
    if (!isEdit && items.length === 0) { setError('Dodajte barem jedan artikl.'); return; }

    setBusy(true);
    setError('');
    try {
      if (isEdit) {
        await api.put(`/orders/${order!.id}`, { order_date: date, due_date: dueDate || null, note });
        // Artikli upisani prilikom uređivanja dodaju se postojećima
        for (const it of items) {
          await api.post(`/orders/${order!.id}/items`, it);
        }
      } else {
        await api.post(`/suppliers/${supplier.id}/orders`, {
          order_date: date,
          due_date: dueDate || null,
          note,
          items,
        });
      }
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Uredi narudžbu' : `Nova narudžba — ${supplier.name}`} onClose={onClose}>
      <ErrorBox msg={error} />

      <div className="field">
        <label>Datum *</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="field">
        <label>Rok isporuke (opcionalno)</label>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </div>

      <div className="field">
        <label>{isEdit ? 'Dodaj artikle (opcionalno)' : 'Artikli *'}</label>
        {lines.map((l, i) => (
          <div key={i} className="btn-row" style={{ marginTop: i === 0 ? 0 : 6 }}>
            <input
              className="inline-input"
              value={l.name}
              onChange={(e) => setLine(i, { name: e.target.value })}
              placeholder={`Naziv artikla ${i + 1}`}
            />
            <input
              className="inline-input qty-input"
              value={l.quantity}
              onChange={(e) => setLine(i, { quantity: e.target.value })}
              placeholder="Količina"
            />
            {lines.length > 1 && (
              <button className="btn btn-sm btn-ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>✕</button>
            )}
          </div>
        ))}
        <button
          className="btn btn-sm btn-ghost"
          style={{ marginTop: 8 }}
          onClick={() => setLines([...lines, { name: '', quantity: '' }])}
        >
          + Još jedan artikl
        </button>
      </div>

      <div className="field">
        <label>Napomena (opcionalno)</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. broj ponude, kontakt osoba" />
      </div>

      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : isEdit ? 'Spremi promjene' : 'Kreiraj narudžbu'}
      </button>
    </Modal>
  );
}

// =====================================================
// Kreiranje / uređivanje dobavljača
// =====================================================
function SupplierModal({ supplier, onClose, onDone }: {
  supplier?: Supplier;
  onClose: () => void;
  onDone: () => void;
}) {
  const isEdit = !!supplier;
  const [name, setName] = useState(supplier?.name || '');
  const [note, setNote] = useState(supplier?.note || '');
  const [active, setActive] = useState(supplier?.active !== false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) { setError('Naziv dobavljača je obavezan.'); return; }
    setBusy(true);
    setError('');
    try {
      if (isEdit) {
        await api.put(`/suppliers/${supplier!.id}`, { name, note, active });
      } else {
        await api.post('/suppliers', { name, note });
      }
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={isEdit ? `Uredi: ${supplier!.name}` : 'Novi dobavljač'} onClose={onClose}>
      <ErrorBox msg={error} />
      <div className="field">
        <label>Naziv *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. REHAU" />
      </div>
      <div className="field">
        <label>Napomena (opcionalno)</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. kontakt, uvjeti plaćanja" />
      </div>
      {isEdit && (
        <label className="checkline">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Aktivan dobavljač
        </label>
      )}
      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : isEdit ? 'Spremi promjene' : 'Dodaj dobavljača'}
      </button>
    </Modal>
  );
}
