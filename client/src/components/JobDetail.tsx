import { useState, useEffect } from 'react';
import { api } from '../api';
import {
  Job, JobWorkLog, User, JobStatus, WorkLogKind,
  JOB_STATUS_LABEL, WORK_LOG_LABEL, fmtDate, fmtDateTime, todayInput,
} from '../types';
import { Modal, ErrorBox, JobBadge } from './ui';

const EVENT_KIND_LABEL: Record<string, string> = {
  komentar: '💬 Komentar',
  status: '🔄 Status',
  transport: '🚚 Transport',
  problem: '⚠️ Problem',
  napredak: '📈 Dnevni napredak',
  napomena: '📌 Napomena za sljedeću ekipu',
  fotografija: '📷 Fotografije',
};

export default function JobDetail({ jobId, me, users, onBack, onChanged }: {
  jobId: number; me: User; users: User[]; onBack: () => void; onChanged: () => void;
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [eventKind, setEventKind] = useState<string | null>(null);
  const [logKind, setLogKind] = useState<WorkLogKind | null>(null);
  const isAdmin = me.role === 'admin';
  const canLogWork = me.role !== 'vozac'; // majstor + admin

  async function load() {
    try {
      setJob(await api.get<Job>(`/jobs/${jobId}`));
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => { load(); }, [jobId]);

  async function setJobStatus(status: JobStatus) {
    try {
      await api.put(`/jobs/${jobId}/status`, { status });
      load();
      onChanged();
    } catch (e: any) { setError(e.message); }
  }

  async function remove() {
    if (!confirm(`Trajno obrisati bauštelu "${job?.name}"? Ova radnja se ne može poništiti.`)) return;
    await api.del(`/jobs/${jobId}`);
    onChanged();
    onBack();
  }

  if (error && !job) {
    return (
      <div>
        <button className="btn btn-ghost" onClick={onBack}>← Natrag</button>
        <div className="error-box" style={{ marginTop: 12 }}>{error}</div>
      </div>
    );
  }
  if (!job) return <div className="empty">Učitavanje…</div>;

  const logs = job.work_logs || [];
  const doneLogs = logs.filter((l) => l.kind === 'odradeno');
  const todoLogs = logs.filter((l) => l.kind === 'za_odraditi');

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack}>← Sve bauštele</button>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="spread">
          <div>
            <h3 style={{ fontSize: 19 }}>{job.name}</h3>
            <div className="muted">
              {job.address && <>{job.address} · </>}
              {job.planned_date && <>Montaža: {fmtDate(job.planned_date)} · </>}
              Kreirao: {job.creator_name}
            </div>
          </div>
          <JobBadge status={job.status} />
        </div>
        {job.note && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{job.note}</p>}
        {job.archived && (
          <div className="row" style={{ marginTop: 8 }}>
            <span className="badge b-gray">Arhivirano</span>
            {job.archived_date && <span className="chip">📅 {fmtDate(job.archived_date)}</span>}
            {job.archive_workers.map((w) => (
              <span key={w.user_id} className="badge b-purple">{w.full_name}</span>
            ))}
          </div>
        )}
        <ErrorBox msg={error} />
        {isAdmin && (
          <div className="btn-row">
            <select
              value={job.status}
              onChange={(e) => setJobStatus(e.target.value as JobStatus)}
              style={{ padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--line)', fontWeight: 700, flex: 1 }}
            >
              {(Object.keys(JOB_STATUS_LABEL) as JobStatus[]).map((s) => (
                <option key={s} value={s}>{JOB_STATUS_LABEL[s]}</option>
              ))}
            </select>
            <button className="btn btn-danger btn-sm" onClick={remove}>Obriši</button>
          </div>
        )}
      </div>

      {/* ---------- Tijek rade ---------- */}
      <WorkSection
        kind="odradeno"
        logs={doneLogs}
        job={job}
        me={me}
        canLog={canLogWork}
        onAdd={() => setLogKind('odradeno')}
        onChanged={() => { load(); onChanged(); }}
        onError={setError}
      />
      <WorkSection
        kind="za_odraditi"
        logs={todoLogs}
        job={job}
        me={me}
        canLog={canLogWork}
        onAdd={() => setLogKind('za_odraditi')}
        onChanged={() => { load(); onChanged(); }}
        onError={setError}
      />

      {/* ---------- Akcije ---------- */}
      <div className="section-title">Akcije</div>
      <div className="btn-row" style={{ marginTop: 0 }}>
        <button className="btn" onClick={() => setEventKind('komentar')}>💬 Komentar</button>
        <button className="btn" onClick={() => setEventKind('napredak')}>📈 Napredak</button>
        <button className="btn" onClick={() => setEventKind('napomena')}>📌 Napomena</button>
        <button className="btn" onClick={() => setEventKind('fotografija')}>📷 Fotografije</button>
        <button className="btn btn-danger" onClick={() => setEventKind('problem')}>⚠️ Prijavi problem</button>
      </div>

      {/* ---------- Feed ---------- */}
      <div className="section-title">Događaji</div>
      <div className="card">
        {(job.events || []).length === 0 && <div className="muted">Još nema zapisa.</div>}
        {(job.events || []).map((e) => (
          <div key={e.id} className={`event k-${e.kind}`}>
            <span className="who">{e.full_name}</span>{' '}
            <span className="chip" style={{ fontSize: 11 }}>{EVENT_KIND_LABEL[e.kind] || e.kind}</span>{' '}
            <span className="when">{fmtDateTime(e.created_at)}</span>
            {e.body && <div className="body">{e.body}</div>}
            {e.photo_path && <img src={e.photo_path} alt="Fotografija" loading="lazy" />}
          </div>
        ))}
      </div>

      {logKind && (
        <WorkLogModal
          jobId={jobId}
          kind={logKind}
          users={users}
          onClose={() => setLogKind(null)}
          onDone={() => { setLogKind(null); load(); onChanged(); }}
        />
      )}
      {eventKind && (
        <EventModal
          jobId={jobId}
          kind={eventKind}
          onClose={() => setEventKind(null)}
          onDone={() => { setEventKind(null); load(); onChanged(); }}
        />
      )}
    </div>
  );
}

// =====================================================
// Tijek rade — dvije sekcije: što je odrađeno / što se mora odradit
// =====================================================
function WorkSection({ kind, logs, job, me, canLog, onAdd, onChanged, onError }: {
  kind: WorkLogKind;
  logs: JobWorkLog[];
  job: Job;
  me: User;
  canLog: boolean;
  onAdd: () => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const isTodo = kind === 'za_odraditi';
  const open = logs.filter((l) => !l.done).length;

  async function toggleDone(log: JobWorkLog) {
    try {
      await api.put(`/jobs/${job.id}/work-logs/${log.id}`, { done: !log.done });
      onChanged();
    } catch (e: any) { onError(e.message); }
  }

  async function remove(log: JobWorkLog) {
    if (!confirm('Obrisati ovaj zapis?')) return;
    try {
      await api.del(`/jobs/${job.id}/work-logs/${log.id}`);
      onChanged();
    } catch (e: any) { onError(e.message); }
  }

  return (
    <>
      <div className="section-title">
        {kind === 'odradeno' ? '✔ ' : '◻ '}{WORK_LOG_LABEL[kind]}
        {isTodo && open > 0 && <span className="chip">{open} otvoreno</span>}
      </div>

      <div className="card">
        {logs.length === 0 && <div className="muted">Nema zapisa.</div>}

        {logs.map((l) => (
          <div key={l.id} className={`worklog${l.done ? ' done' : ''}`}>
            <div className="spread">
              <div style={{ minWidth: 0 }}>
                <div className="nm">
                  {l.work_date ? fmtDate(l.work_date) : 'bez datuma'}
                  {l.done && <> <span className="badge b-green">Odrađeno</span></>}
                </div>
                <div className="rl">
                  {l.workers.length > 0
                    ? l.workers.map((w) => w.full_name).join(', ')
                    : `upisao ${l.created_by_name}`}
                </div>
              </div>
              {isTodo && canLog && (
                <button
                  className={`btn btn-sm ${l.done ? 'btn-ghost' : 'btn-green'}`}
                  onClick={() => toggleDone(l)}
                >{l.done ? 'Vrati' : '✔ Odrađeno'}</button>
              )}
            </div>
            {l.body && <div className="body">{l.body}</div>}
            {(me.role === 'admin' || l.created_by === me.id) && (
              <button className="btn btn-sm btn-ghost" onClick={() => remove(l)}>Obriši</button>
            )}
          </div>
        ))}

        {canLog && (
          <div className="btn-row" style={{ borderTop: logs.length ? '1px solid var(--line)' : 'none', paddingTop: logs.length ? 12 : 0 }}>
            <button className="btn btn-sm btn-primary" onClick={onAdd}>+ {WORK_LOG_LABEL[kind]}</button>
          </div>
        )}
      </div>
    </>
  );
}

/** Unos u tijek rade: majstori, datum i komentar — sve je opcionalno. */
function WorkLogModal({ jobId, kind, users, onClose, onDone }: {
  jobId: number; kind: WorkLogKind; users: User[]; onClose: () => void; onDone: () => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [date, setDate] = useState(kind === 'odradeno' ? todayInput() : '');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const candidates = users.filter((u) => u.active !== false && u.role !== 'vozac');

  function toggle(id: number) {
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  async function submit() {
    if (!body.trim() && selected.length === 0 && !date) {
      setError('Upišite barem komentar, majstora ili datum.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post(`/jobs/${jobId}/work-logs`, {
        kind,
        work_date: date || null,
        body,
        worker_ids: selected,
      });
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={WORK_LOG_LABEL[kind]} onClose={onClose}>
      <ErrorBox msg={error} />

      <div className="field">
        <label>Koji majstori su bili (opcionalno) {selected.length > 0 && `(${selected.length})`}</label>
        {candidates.map((u) => (
          <label key={u.id} className="checkline">
            <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
            {u.full_name} <span className="chip">{u.role}</span>
          </label>
        ))}
        {candidates.length === 0 && <div className="muted">Nema majstora u sustavu.</div>}
      </div>

      <div className="field">
        <label>Datum (opcionalno)</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="field">
        <label>Komentar (opcionalno)</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={kind === 'odradeno' ? 'Što je odrađeno?' : 'Što se mora odraditi?'}
        />
      </div>

      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : 'Spremi zapis'}
      </button>
    </Modal>
  );
}

// ---------- Univerzalni događaj: komentar / problem / napredak / napomena / fotografija ----------
function EventModal({ jobId, kind, onClose, onDone }: {
  jobId: number; kind: string; onClose: () => void; onDone: () => void;
}) {
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const TITLES: Record<string, string> = {
    komentar: 'Novi komentar',
    problem: 'Prijavi problem',
    napredak: 'Dnevni napredak',
    napomena: 'Napomena za sljedeću ekipu',
    fotografija: 'Dodaj fotografije',
  };
  const PLACEHOLDER: Record<string, string> = {
    komentar: 'npr. staklo dolazi 27.7., materijali poslani na farbanje…',
    problem: 'Opišite problem…',
    napredak: 'Što je danas odrađeno?',
    napomena: 'Što ostaje za odraditi kad sljedeća ekipa preuzme?',
    fotografija: 'Opis fotografije (opcionalno)',
  };

  function pickPhoto(f: File | null) {
    setPhoto(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function submit() {
    if (!body.trim() && !photo) { setError('Dodajte komentar ili fotografiju.'); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('kind', kind);
      form.append('body', body);
      if (photo) form.append('photo', photo);
      await api.postForm(`/jobs/${jobId}/events`, form);
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={TITLES[kind] || 'Zapis'} onClose={onClose}>
      <ErrorBox msg={error} />
      <div className="field">
        <textarea placeholder={PLACEHOLDER[kind]} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <div className="field">
        <label>Fotografija (opcionalno)</label>
        <input type="file" accept="image/*" onChange={(e) => pickPhoto(e.target.files?.[0] || null)} />
        {preview && <img className="photo-preview" src={preview} alt="Pregled" />}
      </div>
      <button className={`btn btn-block ${kind === 'problem' ? 'btn-danger' : 'btn-primary'}`} onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : 'Spremi'}
      </button>
    </Modal>
  );
}
