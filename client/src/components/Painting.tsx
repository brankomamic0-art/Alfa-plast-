import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { PaintingEntry, PaintingItem, PaintingLocation, User, fmtDate, fmtDateTime, toDateInput, todayInput } from '../types';
import { Modal, ErrorBox } from './ui';

/**
 * Evidencija farbanja. Vodi je administrator (kreiranje, izmjene, brisanje),
 * a svi je mogu pogledati. Kvačicu "ofarbano" smiju staviti administrator
 * i vozač s te evidencije.
 */
export default function Painting({ me, users }: { me: User; users: User[] }) {
  const [entries, setEntries] = useState<PaintingEntry[]>([]);
  const [locations, setLocations] = useState<PaintingLocation[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Pretraga: datum (od/do), mjesto farbanja, naziv artikla
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [locationId, setLocationId] = useState('');
  const [search, setSearch] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [showLocations, setShowLocations] = useState(false);
  const [editEntry, setEditEntry] = useState<PaintingEntry | null>(null);

  const isAdmin = me.role === 'admin';
  const hasFilter = !!(from || to || locationId || search.trim());

  const loadLocations = useCallback(async () => {
    try {
      setLocations(await api.get<PaintingLocation[]>('/painting/locations'));
    } catch (e: any) { setError(e.message); }
  }, []);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (locationId) params.set('location_id', locationId);
    if (search.trim()) params.set('q', search.trim());
    try {
      setEntries(await api.get<PaintingEntry[]>(`/painting?${params.toString()}`));
      setError('');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [from, to, locationId, search]);

  useEffect(() => { loadLocations(); }, [loadLocations]);

  // Tipkanje u pretragu ne šalje zahtjev na svaki znak
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]);

  function resetFilters() {
    setFrom(''); setTo(''); setLocationId(''); setSearch('');
  }

  return (
    <div>
      {isAdmin && (
        <div className="btn-row" style={{ marginTop: 0, marginBottom: 12 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setShowCreate(true)}>
            + Nova evidencija
          </button>
          <button className="btn btn-ghost" onClick={() => setShowLocations(true)}>Mjesta</button>
        </div>
      )}

      <div className="search-bar">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Naziv artikla…"
          style={{ flexBasis: '100%' }}
        />
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">Sva mjesta</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}{l.active ? '' : ' (neaktivno)'}</option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Datum od" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Datum do" />
      </div>
      {hasFilter && (
        <div className="btn-row" style={{ marginTop: 0, marginBottom: 12 }}>
          <button className="btn btn-sm btn-ghost" onClick={resetFilters}>✕ Poništi filtere</button>
          <span className="chip">{entries.length} {entryWord(entries.length)}</span>
        </div>
      )}

      <div className="section-title">Evidencija farbanja</div>

      <ErrorBox msg={error} />

      {loading && <div className="muted">Učitavanje…</div>}
      {!loading && entries.length === 0 && (
        <div className="empty">
          {hasFilter ? 'Nema evidencija za zadanu pretragu.' : 'Još nema evidencija farbanja.'}
        </div>
      )}

      {entries.map((e) => (
        <EntryCard
          key={e.id}
          entry={e}
          me={me}
          highlight={search.trim()}
          onChanged={load}
          onEdit={() => setEditEntry(e)}
          onError={setError}
        />
      ))}

      {showCreate && (
        <EntryModal
          users={users}
          locations={locations.filter((l) => l.active)}
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); load(); }}
        />
      )}
      {editEntry && (
        <EntryModal
          entry={editEntry}
          users={users}
          locations={locations.filter((l) => l.active || l.id === editEntry.location_id)}
          onClose={() => setEditEntry(null)}
          onDone={() => { setEditEntry(null); load(); }}
        />
      )}
      {showLocations && (
        <LocationsModal
          locations={locations}
          onClose={() => setShowLocations(false)}
          onChanged={() => { loadLocations(); load(); }}
        />
      )}
    </div>
  );
}

/** 1 evidencija · 2-4 evidencije · 5+ evidencija */
function entryWord(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'evidencija';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'evidencije';
  return 'evidencija';
}

// =====================================================
// Kartica jedne evidencije
// =====================================================
function EntryCard({ entry, me, highlight, onChanged, onEdit, onError }: {
  entry: PaintingEntry;
  me: User;
  highlight: string;
  onChanged: () => void;
  onEdit: () => void;
  onError: (msg: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const isAdmin = me.role === 'admin';
  const canCheck = isAdmin || entry.driver_id === me.id;
  const allDone = entry.item_count > 0 && entry.done_count === entry.item_count;

  async function toggle(item: PaintingItem) {
    if (!canCheck) return;
    setBusyId(item.id);
    try {
      await api.put(`/painting/items/${item.id}`, { done: !item.done });
      onChanged();
    } catch (e: any) { onError(e.message); }
    setBusyId(null);
  }

  async function addItem() {
    if (!newItem.trim()) return;
    try {
      await api.post(`/painting/${entry.id}/items`, { name: newItem });
      setNewItem('');
      setAdding(false);
      onChanged();
    } catch (e: any) { onError(e.message); }
  }

  async function removeItem(item: PaintingItem) {
    if (!confirm(`Obrisati artikl "${item.name}"?`)) return;
    try {
      await api.del(`/painting/items/${item.id}`);
      onChanged();
    } catch (e: any) { onError(e.message); }
  }

  async function removeEntry() {
    if (!confirm(`Obrisati evidenciju od ${fmtDate(entry.entry_date)} (${entry.location_name})?`)) return;
    try {
      await api.del(`/painting/${entry.id}`);
      onChanged();
    } catch (e: any) { onError(e.message); }
  }

  return (
    <div className="card">
      <div className="spread">
        <div>
          <h3>{fmtDate(entry.entry_date)} · {entry.location_name}</h3>
          <div className="muted">
            🚚 {entry.driver_name || 'Vozač nije upisan'} · unio {entry.created_by_name}
          </div>
        </div>
        <span className={`badge ${allDone ? 'b-green' : 'b-amber'}`}>
          {entry.done_count}/{entry.item_count} {allDone ? '✔' : ''}
        </span>
      </div>

      {entry.note && <div className="muted" style={{ marginTop: 6 }}>{entry.note}</div>}

      <div className="check-list">
        {entry.items.map((it) => (
          <label key={it.id} className={`check-item${it.done ? ' done' : ''}`}>
            <input
              type="checkbox"
              checked={it.done}
              disabled={!canCheck || busyId === it.id}
              onChange={() => toggle(it)}
            />
            <span className="grow">
              <span className="nm">{mark(it.name, highlight)}</span>
              {it.done && it.done_at && (
                <span className="rl"> Ofarbano {fmtDateTime(it.done_at)}{it.done_by_name ? ` · ${it.done_by_name}` : ''}</span>
              )}
            </span>
            {isAdmin && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={(ev) => { ev.preventDefault(); removeItem(it); }}
              >✕</button>
            )}
          </label>
        ))}
        {entry.items.length === 0 && <div className="muted">Nema artikala.</div>}
      </div>

      {isAdmin && (
        adding ? (
          <div className="btn-row">
            <input
              className="inline-input"
              autoFocus
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
              placeholder="Naziv artikla"
            />
            <button className="btn btn-sm btn-primary" onClick={addItem}>Dodaj</button>
            <button className="btn btn-sm btn-ghost" onClick={() => { setAdding(false); setNewItem(''); }}>Odustani</button>
          </div>
        ) : (
          <div className="btn-row">
            <button className="btn btn-sm btn-ghost" onClick={() => setAdding(true)}>+ Artikl</button>
            <button className="btn btn-sm btn-ghost" onClick={onEdit}>Uredi</button>
            <button className="btn btn-sm btn-ghost" onClick={removeEntry}>Obriši</button>
          </div>
        )
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
// Kreiranje / uređivanje evidencije (admin)
// =====================================================
function EntryModal({ entry, users, locations, onClose, onDone }: {
  entry?: PaintingEntry;
  users: User[];
  locations: PaintingLocation[];
  onClose: () => void;
  onDone: () => void;
}) {
  const isEdit = !!entry;
  const [date, setDate] = useState(entry ? toDateInput(entry.entry_date) : todayInput());
  const [driverId, setDriverId] = useState(entry?.driver_id ? String(entry.driver_id) : '');
  const [locId, setLocId] = useState(entry ? String(entry.location_id) : String(locations[0]?.id || ''));
  const [note, setNote] = useState(entry?.note || '');
  const [items, setItems] = useState<string[]>(['']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const drivers = users.filter((u) => u.role === 'vozac' && u.active !== false);
  const others = users.filter((u) => u.role !== 'vozac' && u.active !== false);

  function setItem(i: number, value: string) {
    setItems(items.map((it, idx) => (idx === i ? value : it)));
  }

  async function submit() {
    if (!date) { setError('Datum je obavezan.'); return; }
    if (!locId) { setError('Odaberite mjesto farbanja.'); return; }
    const names = items.map((s) => s.trim()).filter(Boolean);
    if (!isEdit && names.length === 0) { setError('Dodajte barem jedan artikl za farbanje.'); return; }

    setBusy(true);
    setError('');
    try {
      if (isEdit) {
        await api.put(`/painting/${entry!.id}`, {
          entry_date: date,
          driver_id: driverId ? Number(driverId) : null,
          location_id: Number(locId),
          note,
        });
        // Artikli upisani prilikom uređivanja dodaju se postojećima
        for (const name of names) {
          await api.post(`/painting/${entry!.id}/items`, { name });
        }
      } else {
        await api.post('/painting', {
          entry_date: date,
          driver_id: driverId ? Number(driverId) : null,
          location_id: Number(locId),
          note,
          items: names,
        });
      }
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Uredi evidenciju' : 'Nova evidencija farbanja'} onClose={onClose}>
      <ErrorBox msg={error} />

      <div className="field">
        <label>Datum *</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="field">
        <label>Vozač</label>
        <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">— nije upisan —</option>
          {drivers.length > 0 && (
            <optgroup label="Vozači">
              {drivers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label="Ostali">
              {others.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </optgroup>
          )}
        </select>
        <div className="muted" style={{ marginTop: 4 }}>
          Vozač dobiva obavijest i može označiti artikle kao ofarbane.
        </div>
      </div>

      <div className="field">
        <label>Mjesto farbanja *</label>
        <select value={locId} onChange={(e) => setLocId(e.target.value)}>
          {locations.length === 0 && <option value="">— dodajte mjesto —</option>}
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      <div className="field">
        <label>{isEdit ? 'Dodaj artikle (opcionalno)' : 'Artikli za farbanje *'}</label>
        {items.map((it, i) => (
          <div key={i} className="btn-row" style={{ marginTop: i === 0 ? 0 : 6 }}>
            <input
              className="inline-input"
              value={it}
              onChange={(e) => setItem(i, e.target.value)}
              placeholder={`Artikl ${i + 1} — npr. ograda 3 m`}
            />
            {items.length > 1 && (
              <button className="btn btn-sm btn-ghost" onClick={() => setItems(items.filter((_, idx) => idx !== i))}>✕</button>
            )}
          </div>
        ))}
        <button className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={() => setItems([...items, ''])}>
          + Još jedan artikl
        </button>
      </div>

      <div className="field">
        <label>Napomena (opcionalno)</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. boja RAL 7016, mat" />
      </div>

      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : isEdit ? 'Spremi promjene' : 'Kreiraj evidenciju'}
      </button>
    </Modal>
  );
}

// =====================================================
// Mjesta farbanja (admin)
// =====================================================
function LocationsModal({ locations, onClose, onChanged }: {
  locations: PaintingLocation[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim()) { setError('Naziv mjesta je obavezan.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.post('/painting/locations', { name });
      setName('');
      onChanged();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  async function remove(l: PaintingLocation) {
    const msg = l.entry_count
      ? `"${l.name}" se koristi u ${l.entry_count} evidencija — bit će sakriveno iz izbornika, a povijest ostaje. Nastaviti?`
      : `Obrisati mjesto "${l.name}"?`;
    if (!confirm(msg)) return;
    try {
      await api.del(`/painting/locations/${l.id}`);
      onChanged();
    } catch (e: any) { setError(e.message); }
  }

  async function toggleActive(l: PaintingLocation) {
    try {
      await api.put(`/painting/locations/${l.id}`, { active: !l.active });
      onChanged();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <Modal title="Mjesta farbanja" onClose={onClose}>
      <ErrorBox msg={error} />

      {locations.map((l) => (
        <div key={l.id} className="switch-line">
          <div>
            <div className="nm">
              {l.name}
              {!l.active && <> <span className="badge b-gray">Neaktivno</span></>}
            </div>
            <div className="rl">{l.entry_count || 0} evidencija</div>
          </div>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => toggleActive(l)}>
              {l.active ? 'Sakrij' : 'Vrati'}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => remove(l)}>✕</button>
          </div>
        </div>
      ))}
      {locations.length === 0 && <div className="muted">Nema mjesta farbanja.</div>}

      <div className="field" style={{ marginTop: 14 }}>
        <label>Novo mjesto farbanja</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="npr. Nova bila"
        />
      </div>
      <button className="btn btn-primary btn-block" onClick={add} disabled={busy}>
        {busy ? 'Spremanje…' : '+ Dodaj mjesto'}
      </button>
    </Modal>
  );
}
