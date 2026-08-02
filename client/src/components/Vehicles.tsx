import { useState } from 'react';
import { api } from '../api';
import { Vehicle, VehicleStatus, User, VEHICLE_STATUS_LABEL, fmtDateTime } from '../types';
import { Modal, ErrorBox, VehicleBadge } from './ui';

export default function Vehicles({ me, vehicles, onChanged }: { me: User; vehicles: Vehicle[]; onChanged: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null);
  const [faultVehicle, setFaultVehicle] = useState<Vehicle | null>(null);
  const isAdmin = me.role === 'admin';
  const isDriver = me.role === 'vozac';
  const visible = vehicles.filter((v) => v.active || isAdmin);

  return (
    <div>
      {isAdmin && (
        <button className="btn btn-primary btn-block" onClick={() => setShowCreate(true)}>
          + Novo vozilo
        </button>
      )}
      <div className="section-title">Vozila</div>
      <div className="card">
        {visible.length === 0 && <div className="muted">Nema dodanih vozila.</div>}
        {visible.map((v) => (
          <div key={v.id} className="switch-line">
            <div>
              <div className="nm">
                {v.registration} {v.active === false && <span className="badge b-gray">Neaktivno</span>}
              </div>
              <div className="rl">
                {v.name && <>{v.name} · </>}
                <VehicleBadge status={v.status} />
                {v.note && <> · {v.note}</>}
              </div>
              <div className="rl" style={{ opacity: 0.6 }}>Ažurirano: {fmtDateTime(v.updated_at)}</div>
            </div>
            <div className="btn-row" style={{ marginTop: 0 }}>
              {isDriver && v.active !== false && (
                <button className="btn btn-sm btn-danger" onClick={() => setFaultVehicle(v)}>⚠ Prijavi kvar</button>
              )}
              {isAdmin && (
                <button className="btn btn-sm btn-ghost" onClick={() => setEditVehicle(v)}>Uredi</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <VehicleModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); onChanged(); }} />
      )}
      {editVehicle && (
        <VehicleModal vehicle={editVehicle} onClose={() => setEditVehicle(null)} onDone={() => { setEditVehicle(null); onChanged(); }} />
      )}
      {faultVehicle && (
        <ReportFaultModal vehicle={faultVehicle} onClose={() => setFaultVehicle(null)} onDone={() => { setFaultVehicle(null); onChanged(); }} />
      )}
    </div>
  );
}

function VehicleModal({ vehicle, onClose, onDone }: { vehicle?: Vehicle; onClose: () => void; onDone: () => void }) {
  const [registration, setRegistration] = useState(vehicle?.registration || '');
  const [name, setName] = useState(vehicle?.name || '');
  const [status, setStatus] = useState<VehicleStatus>(vehicle?.status || 'ispravno');
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
        await api.put(`/vehicles/${vehicle!.id}`, { registration, name, status, note, active });
      } else {
        await api.post('/vehicles', { registration, name, status });
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
      <div className="field">
        <label>Status</label>
        <div className="btn-row" style={{ marginTop: 4 }}>
          {(Object.keys(VEHICLE_STATUS_LABEL) as VehicleStatus[]).map((s) => (
            <button
              key={s}
              className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setStatus(s)}
            >{VEHICLE_STATUS_LABEL[s]}</button>
          ))}
        </div>
      </div>
      {isEdit && (
        <>
          <div className="field">
            <label>Napomena (opcionalno)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. opis kvara" />
          </div>
          <label className="checkline">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Aktivno vozilo (prikazano vozačima)
          </label>
        </>
      )}
      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : isEdit ? 'Spremi promjene' : 'Dodaj vozilo'}
      </button>
    </Modal>
  );
}

function ReportFaultModal({ vehicle, onClose, onDone }: { vehicle: Vehicle; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/vehicles/${vehicle.id}/report-fault`, { comment });
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
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Što ne radi?" />
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Vozilo će biti označeno kao "U kvaru", a svi administratori dobit će obavijest odmah.
      </p>
      <button className="btn btn-danger btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Slanje…' : 'Prijavi kvar'}
      </button>
    </Modal>
  );
}
