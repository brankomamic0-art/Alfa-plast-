import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Job, User, fmtDate, toDateInput, todayInput } from '../types';
import { Modal, ErrorBox, JobBadge } from './ui';

export default function Jobs({ me, users, refreshKey, onOpenJob }: {
  me: User; users: User[]; refreshKey: number; onOpenJob: (id: number) => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [showArchive, setShowArchive] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [archiveJob, setArchiveJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const isAdmin = me.role === 'admin';

  const load = useCallback(async () => {
    try {
      setJobs(await api.get<Job[]>(`/jobs?archived=${showArchive}`));
      setError('');
    } catch (e: any) { setError(e.message); }
  }, [showArchive]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function restore(job: Job) {
    if (!confirm(`Vratiti "${job.name}" iz arhive?`)) return;
    try {
      await api.put(`/jobs/${job.id}/archive`, { archived: false });
      load();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      {/* Aktivne / Arhiva — arhivu vodi administrator */}
      {isAdmin && (
        <div className="subtabs">
          <button className={showArchive ? '' : 'active'} onClick={() => setShowArchive(false)}>Aktivne</button>
          <button className={showArchive ? 'active' : ''} onClick={() => setShowArchive(true)}>Arhiva</button>
        </div>
      )}

      {isAdmin && !showArchive && (
        <button className="btn btn-primary btn-block" onClick={() => setShowCreate(true)}>
          + Nova bauštela
        </button>
      )}

      <ErrorBox msg={error} />

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
        <div key={j.id} className="card">
          <div className="spread clickable" onClick={() => onOpenJob(j.id)} role="button">
            <div>
              <h3>{j.name}</h3>
              <div className="muted">
                {j.address && <>{j.address} · </>}
                {j.planned_date && <>Montaža: {fmtDate(j.planned_date)} · </>}
                {j.creator_name}
              </div>
              {j.leader_name && <div className="muted">👷 Voditelj: {j.leader_name}</div>}
            </div>
            <JobBadge status={j.status} />
          </div>

          {showArchive ? (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="chip">📅 {j.archived_date ? fmtDate(j.archived_date) : 'datum nije upisan'}</span>
              {j.archive_workers.length > 0
                ? j.archive_workers.map((w) => (
                    <span key={w.user_id} className="badge b-purple">{w.full_name}</span>
                  ))
                : <span className="chip">majstori nisu upisani</span>}
            </div>
          ) : (
            ((j.done_count || 0) > 0 || (j.todo_count || 0) > 0) && (
              <div className="row" style={{ marginTop: 8 }}>
                {!!j.done_count && <span className="badge b-green">✔ {j.done_count} odrađeno</span>}
                {!!j.todo_count && <span className="badge b-amber">◻ {j.todo_count} za odradit</span>}
              </div>
            )
          )}

          {isAdmin && (
            <div className="btn-row">
              {showArchive ? (
                <>
                  <button className="btn btn-sm btn-ghost" onClick={() => setArchiveJob(j)}>Uredi podatke arhive</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => restore(j)}>Vrati iz arhive</button>
                </>
              ) : (
                <button className="btn btn-sm btn-ghost" onClick={() => setArchiveJob(j)}>Arhiviraj</button>
              )}
            </div>
          )}
        </div>
      ))}

      {showCreate && (
        <CreateJobModal
          users={users}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); load(); onOpenJob(id); }}
        />
      )}
      {archiveJob && (
        <ArchiveModal
          job={archiveJob}
          users={users}
          onClose={() => setArchiveJob(null)}
          onDone={() => { setArchiveJob(null); load(); }}
        />
      )}
    </div>
  );
}

// =====================================================
// Arhiviranje: administrator upisuje majstore (može ih biti više) i datum
// =====================================================
function ArchiveModal({ job, users, onClose, onDone }: {
  job: Job; users: User[]; onClose: () => void; onDone: () => void;
}) {
  const [selected, setSelected] = useState<number[]>(job.archive_workers.map((w) => w.user_id));
  const [date, setDate] = useState(job.archived_date ? toDateInput(job.archived_date) : todayInput());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isEdit = job.archived;
  const candidates = users.filter((u) => u.active !== false);

  function toggle(id: number) {
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api.put(`/jobs/${job.id}/archive`, {
        archived: true,
        archived_date: date || null,
        worker_ids: selected,
      });
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={isEdit ? `Arhiva: ${job.name}` : `Arhiviraj: ${job.name}`} onClose={onClose}>
      <ErrorBox msg={error} />

      <div className="field">
        <label>Ime majstora {selected.length > 0 && `(${selected.length})`}</label>
        {candidates.map((u) => (
          <label key={u.id} className="checkline">
            <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
            {u.full_name} <span className="chip">{u.role}</span>
          </label>
        ))}
        {candidates.length === 0 && <div className="muted">Nema korisnika.</div>}
      </div>

      <div className="field">
        <label>Datum</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : isEdit ? 'Spremi promjene' : 'Arhiviraj bauštelu'}
      </button>
    </Modal>
  );
}

/** Odabir voditelja bauštele: aktivni majstori i administratori (vozači ne vode ekipu). */
export function LeaderSelect({ users, value, onChange }: {
  users: User[]; value: string; onChange: (id: string) => void;
}) {
  const candidates = users.filter((u) => u.active !== false && u.role !== 'vozac');
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— nije odabran —</option>
      {candidates.map((u) => (
        <option key={u.id} value={u.id}>{u.full_name}</option>
      ))}
    </select>
  );
}

function CreateJobModal({ users, onClose, onCreated }: {
  users: User[]; onClose: () => void; onCreated: (id: number) => void;
}) {
  const [name, setName] = useState('');
  const [leaderId, setLeaderId] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) { setError('Ime bauštele je obavezno.'); return; }
    setBusy(true);
    try {
      const job = await api.post<Job>('/jobs', {
        name, address, note,
        planned_date: plannedDate || null,
        leader_id: leaderId ? Number(leaderId) : null,
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
        <label>Voditelj bauštele</label>
        <LeaderSelect users={users} value={leaderId} onChange={setLeaderId} />
        <div className="muted" style={{ marginTop: 4 }}>
          Voditelj vodi ekipu i upisuje u aplikaciju što je odrađeno.
        </div>
      </div>
      <div className="field">
        <label>Planirani datum montaže</label>
        <input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
        <div className="muted" style={{ marginTop: 4 }}>
          3 dana prije datuma automatski se kreira podsjetnik u to-do listi.
        </div>
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
