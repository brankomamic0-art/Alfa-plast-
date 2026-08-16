import { useEffect, useState } from 'react';
import { api } from '../api';
import {
  Vehicle, VehicleDetail, VehicleFault, VehicleServiceRecord, ServiceType, User,
  SERVICE_LABEL, fmtDate, fmtDateTime, daysUntil,
} from '../types';
import { Modal, ErrorBox, VehicleBadge } from './ui';

export default function Vehicles({ me, vehicles, onChanged }: { me: User; vehicles: Vehicle[]; onChanged: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const isAdmin = me.role === 'admin';
  const visible = vehicles.filter((v) => v.active || isAdmin);

  return (
    <div>
      {isAdmin && (
        <button className="btn btn-primary btn-block" onClick={() => setShowCreate(true)}>
          + Novo vozilo
        </button>
      )}

      <div className="section-title">Vozila</div>

      {visible.length === 0 && <div className="empty">Nema dodanih vozila.</div>}

      {visible.map((v) => (
        <div key={v.id} className="card clickable" onClick={() => setOpenId(v.id)} role="button">
          <div className="spread">
            <div>
              <h3>
                {v.registration}
                {v.active === false && <> <span className="badge b-gray">Neaktivno</span></>}
              </h3>
              <div className="muted">{v.name || 'Bez naziva'}</div>
            </div>
            <VehicleBadge status={v.status} />
          </div>

          <div className="row" style={{ marginTop: 8 }}>
            {!!v.open_faults && (
              <span className="badge b-red">⚠ {v.open_faults} {faultWord(v.open_faults)}</span>
            )}
            {/* Izmjena ulja je vidljiva svim ulogama */}
            <span className="chip">
              🛢 Ulje: {v.last_oil_date ? fmtDate(v.last_oil_date) : 'nema zapisa'}
              {v.last_oil_odometer ? ` · ${v.last_oil_odometer.toLocaleString('hr-HR')} km` : ''}
            </span>
            {/* Registracija i tehnički su privatni — server ih šalje samo administratoru */}
            {isAdmin && <ExpiryChip label="📄 Registracija" date={v.registration_until} />}
            {isAdmin && <ExpiryChip label="🔧 Tehnički" date={v.inspection_until} />}
          </div>
        </div>
      ))}

      {showCreate && (
        <VehicleModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); onChanged(); }} />
      )}
      {openId !== null && (
        <VehicleDetailModal
          me={me}
          vehicleId={openId}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
          onDeleted={() => { setOpenId(null); onChanged(); }}
        />
      )}
    </div>
  );
}

/** 1 kvar · 2-4 kvara · 5+ kvarova */
function faultWord(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'kvar';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'kvara';
  return 'kvarova';
}

/** Chip s datumom isteka: crveno kad je isteklo, žuto kad ističe unutar 30 dana. */
function ExpiryChip({ label, date }: { label: string; date: string | null | undefined }) {
  if (!date) return <span className="chip">{label}: nema zapisa</span>;
  const left = daysUntil(date)!;
  const cls = left < 0 ? 'badge b-red' : left <= 30 ? 'badge b-amber' : 'chip';
  const suffix = left < 0 ? ' · isteklo' : left <= 30 ? ` · još ${left} d` : '';
  return <span className={cls}>{label}: {fmtDate(date)}{suffix}</span>;
}

// =====================================================
// Detalji vozila
// =====================================================
function VehicleDetailModal({ me, vehicleId, onClose, onChanged, onDeleted }: {
  me: User; vehicleId: number; onClose: () => void; onChanged: () => void; onDeleted: () => void;
}) {
  const [v, setV] = useState<VehicleDetail | null>(null);
  const [error, setError] = useState('');
  const [showFault, setShowFault] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [addType, setAddType] = useState<ServiceType | null>(null);
  const [resolving, setResolving] = useState<VehicleFault | null>(null);
  const isAdmin = me.role === 'admin';

  async function load() {
    try {
      setV(await api.get<VehicleDetail>(`/vehicles/${vehicleId}`));
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => { load(); }, [vehicleId]);

  /** Osvježi i detalje i listu u pozadini. */
  async function refresh() {
    await load();
    onChanged();
  }

  async function deleteFault(f: VehicleFault) {
    if (!confirm('Obrisati ovu prijavu kvara?')) return;
    try {
      await api.del(`/vehicles/${vehicleId}/faults/${f.id}`);
      await refresh();
    } catch (e: any) { setError(e.message); }
  }

  async function deleteRecord(r: VehicleServiceRecord) {
    if (!confirm(`Obrisati zapis: ${SERVICE_LABEL[r.type]} — ${fmtDate(r.done_date)}?`)) return;
    try {
      await api.del(`/vehicles/${vehicleId}/service/${r.id}`);
      await refresh();
    } catch (e: any) { setError(e.message); }
  }

  async function deleteVehicle() {
    if (!v) return;
    if (!confirm(`Obrisati vozilo ${v.registration}? Briše se i sva povijest.`)) return;
    try {
      await api.del(`/vehicles/${vehicleId}`);
      onDeleted();
    } catch (e: any) { setError(e.message); }
  }

  if (!v) {
    return (
      <Modal title="Vozilo" onClose={onClose}>
        <ErrorBox msg={error} />
        {!error && <div className="muted">Učitavanje…</div>}
      </Modal>
    );
  }

  const open = v.faults.filter((f) => !f.resolved);
  const resolved = v.faults.filter((f) => f.resolved);
  const oil = v.service.filter((r) => r.type === 'ulje');
  const registration = v.service.filter((r) => r.type === 'registracija');
  const inspection = v.service.filter((r) => r.type === 'tehnicki');

  return (
    <Modal title={v.registration} onClose={onClose}>
      <ErrorBox msg={error} />

      <div className="row">
        <VehicleBadge status={v.status} />
        {v.name && <span className="chip">{v.name}</span>}
        {v.active === false && <span className="badge b-gray">Neaktivno</span>}
      </div>
      {v.note && <div className="muted" style={{ marginTop: 8 }}>{v.note}</div>}
      <div className="muted" style={{ marginTop: 4, opacity: 0.7 }}>Ažurirano: {fmtDateTime(v.updated_at)}</div>

      <div className="btn-row">
        {/* Kvar može prijaviti bilo koja uloga */}
        <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => setShowFault(true)}>⚠ Prijavi kvar</button>
        {isAdmin && <button className="btn btn-ghost" onClick={() => setShowEdit(true)}>Uredi</button>}
        {isAdmin && <button className="btn btn-ghost" onClick={deleteVehicle}>Obriši</button>}
      </div>

      {/* ---------- Kvarovi ---------- */}
      <div className="section-title">Otvoreni kvarovi {open.length > 0 && `(${open.length})`}</div>
      {open.length === 0 && <div className="muted">Nema prijavljenih kvarova.</div>}
      {open.map((f) => (
        <div key={f.id} className="event k-problem">
          <div className="who">{f.reporter_name}</div>
          <div className="when">{fmtDateTime(f.created_at)}</div>
          <div className="body">{f.description}</div>
          {isAdmin && (
            <div className="btn-row" style={{ marginTop: 6 }}>
              <button className="btn btn-sm btn-green" onClick={() => setResolving(f)}>✔ Riješeno</button>
              <button className="btn btn-sm btn-ghost" onClick={() => deleteFault(f)}>Obriši</button>
            </div>
          )}
        </div>
      ))}

      {resolved.length > 0 && (
        <>
          <div className="section-title">Riješeni kvarovi</div>
          {resolved.map((f) => (
            <div key={f.id} className="event k-napredak">
              <div className="who">{f.reporter_name}</div>
              <div className="when">
                Prijavljeno {fmtDateTime(f.created_at)}
                {f.resolved_at && <> · riješio {f.resolver_name} {fmtDateTime(f.resolved_at)}</>}
              </div>
              <div className="body">{f.description}</div>
              {f.resolve_note && <div className="muted" style={{ marginTop: 2 }}>↳ {f.resolve_note}</div>}
              {isAdmin && (
                <div className="btn-row" style={{ marginTop: 6 }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => deleteFault(f)}>Obriši</button>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* ---------- Izmjena ulja: vide svi ---------- */}
      <ServiceSection
        type="ulje"
        records={oil}
        isAdmin={isAdmin}
        onAdd={() => setAddType('ulje')}
        onDelete={deleteRecord}
      />

      {/* ---------- Privatno: samo administrator ---------- */}
      {isAdmin && (
        <>
          <ServiceSection
            type="registracija"
            records={registration}
            isAdmin
            privateNote
            onAdd={() => setAddType('registracija')}
            onDelete={deleteRecord}
          />
          <ServiceSection
            type="tehnicki"
            records={inspection}
            isAdmin
            privateNote
            onAdd={() => setAddType('tehnicki')}
            onDelete={deleteRecord}
          />
        </>
      )}

      {showFault && (
        <ReportFaultModal
          vehicle={v}
          onClose={() => setShowFault(false)}
          onDone={() => { setShowFault(false); refresh(); }}
        />
      )}
      {showEdit && (
        <VehicleModal
          vehicle={v}
          onClose={() => setShowEdit(false)}
          onDone={() => { setShowEdit(false); refresh(); }}
        />
      )}
      {addType && (
        <ServiceModal
          vehicleId={vehicleId}
          type={addType}
          onClose={() => setAddType(null)}
          onDone={() => { setAddType(null); refresh(); }}
        />
      )}
      {resolving && (
        <ResolveFaultModal
          vehicleId={vehicleId}
          fault={resolving}
          onClose={() => setResolving(null)}
          onDone={() => { setResolving(null); refresh(); }}
        />
      )}
    </Modal>
  );
}

function ServiceSection({ type, records, isAdmin, privateNote, onAdd, onDelete }: {
  type: ServiceType;
  records: VehicleServiceRecord[];
  isAdmin: boolean;
  privateNote?: boolean;
  onAdd: () => void;
  onDelete: (r: VehicleServiceRecord) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? records : records.slice(0, 3);

  return (
    <>
      <div className="section-title">
        {SERVICE_LABEL[type]}
        {privateNote && <span className="chip">🔒 samo admin</span>}
      </div>

      {records.length === 0 && <div className="muted">Nema zapisa.</div>}

      {shown.map((r, i) => (
        <div key={r.id} className="switch-line">
          <div>
            <div className="nm">
              {fmtDate(r.done_date)}
              {i === 0 && records.length > 1 && <> <span className="badge b-green">Zadnje</span></>}
            </div>
            <div className="rl">
              {r.odometer !== null && <>{r.odometer.toLocaleString('hr-HR')} km · </>}
              {r.valid_until && <>vrijedi do {fmtDate(r.valid_until)} · </>}
              {r.created_by_name}
            </div>
            {r.note && <div className="rl">{r.note}</div>}
          </div>
          {isAdmin && (
            <button className="btn btn-sm btn-ghost" onClick={() => onDelete(r)}>✕</button>
          )}
        </div>
      ))}

      <div className="btn-row">
        {isAdmin && <button className="btn btn-sm btn-ghost" onClick={onAdd}>+ Dodaj zapis</button>}
        {records.length > 3 && (
          <button className="btn btn-sm btn-ghost" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Prikaži manje' : `Cijela povijest (${records.length})`}
          </button>
        )}
      </div>
    </>
  );
}

function ServiceModal({ vehicleId, type, onClose, onDone }: {
  vehicleId: number; type: ServiceType; onClose: () => void; onDone: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [doneDate, setDoneDate] = useState(today);
  const [validUntil, setValidUntil] = useState('');
  const [odometer, setOdometer] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isOil = type === 'ulje';

  async function submit() {
    if (!doneDate) { setError('Datum je obavezan.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.post(`/vehicles/${vehicleId}/service`, {
        type,
        done_date: doneDate,
        valid_until: isOil ? null : validUntil || null,
        odometer: odometer === '' ? null : Number(odometer),
        note,
      });
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={SERVICE_LABEL[type]} onClose={onClose}>
      <ErrorBox msg={error} />
      <div className="field">
        <label>{isOil ? 'Datum izmjene' : 'Datum obavljanja'}</label>
        <input type="date" value={doneDate} onChange={(e) => setDoneDate(e.target.value)} />
      </div>
      {!isOil && (
        <div className="field">
          <label>Vrijedi do</label>
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
      )}
      <div className="field">
        <label>Kilometraža (opcionalno)</label>
        <input
          type="number"
          inputMode="numeric"
          value={odometer}
          onChange={(e) => setOdometer(e.target.value)}
          placeholder="npr. 184000"
        />
      </div>
      <div className="field">
        <label>Napomena (opcionalno)</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={isOil ? 'npr. zamijenjen i filter' : ''} />
      </div>
      {type !== 'ulje' && (
        <p className="muted" style={{ marginTop: 0 }}>Ovaj zapis vidi samo administrator.</p>
      )}
      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : 'Spremi zapis'}
      </button>
    </Modal>
  );
}

// =====================================================
// Kreiranje / uređivanje vozila (admin)
// =====================================================
function VehicleModal({ vehicle, onClose, onDone }: { vehicle?: Vehicle; onClose: () => void; onDone: () => void }) {
  const [registration, setRegistration] = useState(vehicle?.registration || '');
  const [name, setName] = useState(vehicle?.name || '');
  const [note, setNote] = useState(vehicle?.note || '');
  const [active, setActive] = useState(vehicle?.active !== false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isEdit = !!vehicle;

  async function submit() {
    if (!registration.trim()) { setError('Registracija je obavezna.'); return; }
    setBusy(true);
    setError('');
    try {
      if (isEdit) {
        await api.put(`/vehicles/${vehicle!.id}`, { registration, name, note, active });
      } else {
        await api.post('/vehicles', { registration, name });
      }
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={isEdit ? `Uredi: ${vehicle!.registration}` : 'Novo vozilo'} onClose={onClose}>
      <ErrorBox msg={error} />
      <div className="field">
        <label>Registracija</label>
        <input value={registration} onChange={(e) => setRegistration(e.target.value)} placeholder="npr. T12-A-345" />
      </div>
      <div className="field">
        <label>Naziv / model (opcionalno)</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. Iveco Daily" />
      </div>
      {isEdit && (
        <>
          <div className="field">
            <label>Napomena (opcionalno)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. rezervni ključ u uredu" />
          </div>
          <label className="checkline">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Aktivno vozilo (prikazano svima)
          </label>
          <p className="muted" style={{ marginTop: 0 }}>
            Status vozila se ne postavlja ručno — vozilo je "U kvaru" dok postoji neriješena prijava kvara.
          </p>
        </>
      )}
      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : isEdit ? 'Spremi promjene' : 'Dodaj vozilo'}
      </button>
    </Modal>
  );
}

function ReportFaultModal({ vehicle, onClose, onDone }: { vehicle: Vehicle; onClose: () => void; onDone: () => void }) {
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!description.trim()) { setError('Opišite kvar.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.post(`/vehicles/${vehicle.id}/faults`, { description });
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Prijavi kvar — ${vehicle.registration}`} onClose={onClose}>
      <ErrorBox msg={error} />
      <div className="field">
        <label>Opis kvara</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Što ne radi?" />
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Vozilo će biti označeno kao "U kvaru", a svi administratori dobit će obavijest odmah.
        Više kvarova na istom vozilu može biti otvoreno istovremeno.
      </p>
      <button className="btn btn-danger btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Slanje…' : 'Prijavi kvar'}
      </button>
    </Modal>
  );
}

function ResolveFaultModal({ vehicleId, fault, onClose, onDone }: {
  vehicleId: number; fault: VehicleFault; onClose: () => void; onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api.put(`/vehicles/${vehicleId}/faults/${fault.id}/resolve`, { note });
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Označi kvar riješenim" onClose={onClose}>
      <ErrorBox msg={error} />
      <div className="event k-problem">
        <div className="who">{fault.reporter_name}</div>
        <div className="when">{fmtDateTime(fault.created_at)}</div>
        <div className="body">{fault.description}</div>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Kako je riješeno (opcionalno)</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. zamijenjen akumulator" />
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Osoba koja je prijavila kvar dobit će obavijest. Vozilo postaje "Ispravno" kad nema više otvorenih kvarova.
      </p>
      <button className="btn btn-green btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : '✔ Riješeno'}
      </button>
    </Modal>
  );
}
