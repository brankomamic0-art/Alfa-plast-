import { useEffect, useState } from 'react';
import { api } from '../api';
import { Job, ItemType, User, ITEM_LABEL, fmtDate } from '../types';
import { Modal, ErrorBox, JobBadge, ItemChain } from './ui';

export default function Jobs({ me, refreshKey, onOpenJob }: { me: User; refreshKey: number; onOpenJob: (id: number) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [showArchive, setShowArchive] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const isAdmin = me.role === 'admin';

  async function load() {
    setJobs(await api.get<Job[]>(`/jobs?archived=${showArchive}`));
  }
  useEffect(() => { load(); }, [refreshKey, showArchive]);

  return (
    <div>
      {isAdmin && (
        <div className="btn-row" style={{ marginTop: 0, marginBottom: 12 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setShowCreate(true)}>
            + Nova bauštela
          </button>
          <button className="btn btn-ghost" onClick={() => setShowArchive(!showArchive)}>
            {showArchive ? '← Aktivne' : 'Arhiva'}
          </button>
        </div>
      )}

      {jobs.length === 0 && (
        <div className="empty">
          {showArchive
            ? 'Arhiva je prazna.'
            : isAdmin
              ? 'Još nema bauštela. Kreirajte prvu.'
              : 'Trenutno nema bauštela spremnih za montažu.'}
        </div>
      )}

      {jobs.map((j) => (
        <div key={j.id} className="card clickable" onClick={() => onOpenJob(j.id)} role="button">
          <div className="spread">
            <div>
              <h3>{j.name}</h3>
              <div className="muted">
                {j.address && <>{j.address} · </>}
                {j.planned_date && <>Montaža: {fmtDate(j.planned_date)} · </>}
                {j.creator_name}
              </div>
            </div>
            <JobBadge status={j.status} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {j.items.map((it) => (
              <span key={it.id} className="chip">{ITEM_LABEL[it.type]}</span>
            ))}
          </div>
          {j.items.map((it) => (
            <ItemChain key={it.id} status={it.status} location={it.location} site={it.site_status} />
          ))}
        </div>
      ))}

      {showCreate && (
        <CreateJobModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); load(); onOpenJob(id); }}
        />
      )}
    </div>
  );
}

function CreateJobModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [items, setItems] = useState<Record<ItemType, boolean>>({ profili: true, staklo: true, spideri: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function toggle(t: ItemType) {
    setItems({ ...items, [t]: !items[t] });
  }

  async function submit() {
    if (!name.trim()) { setError('Ime bauštele je obavezno.'); return; }
    setBusy(true);
    try {
      const selected = (Object.keys(items) as ItemType[]).filter((t) => items[t]);
      const job = await api.post<Job>('/jobs', {
        name, address, note,
        planned_date: plannedDate || null,
        items: selected,
      });
      onCreated(job.id);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Nova bauštela" onClose={onClose}>
      <ErrorBox msg={error} />
      <div className="field">
        <label>Ime bauštele *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. Vila Marina — Trilj" />
      </div>
      <div className="field">
        <label>Adresa / lokacija</label>
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="field">
        <label>Planirani datum montaže</label>
        <input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
        <div className="muted" style={{ marginTop: 4 }}>
          3 dana prije datuma automatski se kreira podsjetnik u to-do listi.
        </div>
      </div>
      <div className="field">
        <label>Što je potrebno (staklene ograde)</label>
        {(['profili', 'staklo', 'spideri'] as ItemType[]).map((t) => (
          <label key={t} className="checkline">
            <input type="checkbox" checked={items[t]} onChange={() => toggle(t)} />
            {ITEM_LABEL[t]}
          </label>
        ))}
      </div>
      <div className="field">
        <label>Napomena</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : 'Kreiraj bauštelu'}
      </button>
    </Modal>
  );
}
