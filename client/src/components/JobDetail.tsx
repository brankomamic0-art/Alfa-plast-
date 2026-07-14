import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  Job, JobItem, User, ItemType, ItemLocation, SiteStatus, ItemStatus, JobStatus,
  ITEM_LABEL, ITEM_STATUS_LABEL, LOCATION_LABEL, SITE_LABEL, JOB_STATUS_LABEL,
  fmtDate, fmtDateTime,
} from '../types';
import { Modal, ErrorBox, JobBadge, ItemStatusBadge, LocationBadge, SiteBadge, ItemChain } from './ui';

const EVENT_KIND_LABEL: Record<string, string> = {
  komentar: '💬 Komentar',
  status: '🔄 Status',
  transport: '🚚 Transport',
  problem: '⚠️ Problem',
  napredak: '📈 Dnevni napredak',
  napomena: '📌 Napomena za sljedeću ekipu',
  fotografija: '📷 Fotografije',
};

export default function JobDetail({ jobId, me, onBack, onChanged }: {
  jobId: number; me: User; onBack: () => void; onChanged: () => void;
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [transportItem, setTransportItem] = useState<JobItem | null>(null);
  const [siteItem, setSiteItem] = useState<JobItem | null>(null);
  const [eventKind, setEventKind] = useState<string | null>(null);
  const isAdmin = me.role === 'admin';
  const canMount = me.role !== 'vozac'; // majstor + admin

  async function load() {
    try {
      const j = await api.get<Job>(`/jobs/${jobId}`);
      setJob(j);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => { load(); }, [jobId]);

  async function setJobStatus(status: JobStatus) {
    try {
      const j = await api.put<Job>(`/jobs/${jobId}/status`, { status });
      setJob({ ...j, events: job?.events });
      load();
      onChanged();
    } catch (e: any) { setError(e.message); }
  }

  async function setItemStatus(item: JobItem, status: ItemStatus) {
    try {
      await api.put(`/jobs/${jobId}/items/${item.id}/status`, { status });
      load();
      onChanged();
    } catch (e: any) { setError(e.message); }
  }

  async function archive(arch: boolean) {
    await api.put(`/jobs/${jobId}`, { archived: arch });
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
            <button className="btn btn-ghost btn-sm" onClick={() => archive(!job.archived)}>
              {job.archived ? 'Vrati iz arhive' : 'Arhiviraj'}
            </button>
          </div>
        )}
      </div>

      {/* ---------- Stavke ---------- */}
      <div className="section-title">Materijali</div>
      <div className="card">
        {job.items.length === 0 && <div className="muted">Nema dodanih stavki.</div>}
        {job.items.map((item, idx) => (
          <div key={item.id} className={idx === 0 ? undefined : 'item-block'}>
            <div className="spread">
              <b style={{ fontSize: 16 }}>{ITEM_LABEL[item.type]}</b>
              <div className="row">
                <ItemStatusBadge status={item.status} />
                <LocationBadge location={item.location} />
                <SiteBadge status={item.site_status} />
              </div>
            </div>
            <ItemChain status={item.status} location={item.location} site={item.site_status} />
            <div className="btn-row">
              {isAdmin && (
                <select
                  value={item.status}
                  onChange={(e) => setItemStatus(item, e.target.value as ItemStatus)}
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--line)', fontWeight: 700, fontSize: 13 }}
                >
                  {(Object.keys(ITEM_STATUS_LABEL) as ItemStatus[]).map((s) => (
                    <option key={s} value={s}>{ITEM_STATUS_LABEL[s]}</option>
                  ))}
                </select>
              )}
              <button className="btn btn-sm" onClick={() => setTransportItem(item)}>🚚 Transport</button>
              {canMount && (
                <button className="btn btn-sm" onClick={() => setSiteItem(item)}>🔧 Montaža</button>
              )}
              {isAdmin && (
                <button
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    if (!confirm(`Ukloniti stavku ${ITEM_LABEL[item.type]}?`)) return;
                    await api.del(`/jobs/${jobId}/items/${item.id}`);
                    load();
                  }}
                >✕</button>
              )}
            </div>
          </div>
        ))}
        {isAdmin && (
          <div className="btn-row" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            {(['profili', 'staklo', 'spideri'] as ItemType[]).map((t) => (
              <button
                key={t}
                className="btn btn-sm btn-ghost"
                onClick={async () => { await api.post(`/jobs/${jobId}/items`, { type: t }); load(); }}
              >+ {ITEM_LABEL[t]}</button>
            ))}
          </div>
        )}
      </div>

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

      {transportItem && (
        <TransportModal
          jobId={jobId}
          item={transportItem}
          onClose={() => setTransportItem(null)}
          onDone={() => { setTransportItem(null); load(); onChanged(); }}
        />
      )}
      {siteItem && (
        <SiteStatusModal
          jobId={jobId}
          item={siteItem}
          onClose={() => setSiteItem(null)}
          onDone={() => { setSiteItem(null); load(); onChanged(); }}
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

// ---------- Transport: lokacija + fotka + komentar ----------
function TransportModal({ jobId, item, onClose, onDone }: {
  jobId: number; item: JobItem; onClose: () => void; onDone: () => void;
}) {
  const [location, setLocation] = useState<ItemLocation | ''>(item.location || '');
  const [comment, setComment] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function pickPhoto(f: File | null) {
    setPhoto(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function submit() {
    if (!location) { setError('Odaberite lokaciju.'); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('location', location);
      form.append('comment', comment);
      if (photo) form.append('photo', photo);
      await api.putForm(`/jobs/${jobId}/items/${item.id}/location`, form);
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Transport — ${ITEM_LABEL[item.type]}`} onClose={onClose}>
      <ErrorBox msg={error} />
      <div className="field">
        <label>Gdje se materijal nalazi?</label>
        <div className="btn-row" style={{ marginTop: 4 }}>
          {(Object.keys(LOCATION_LABEL) as ItemLocation[]).map((loc) => (
            <button
              key={loc}
              className={`btn btn-sm ${location === loc ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setLocation(loc)}
            >{LOCATION_LABEL[loc]}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Komentar / problem (opcionalno)</label>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <div className="field">
        <label>Fotografija (opcionalno)</label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => pickPhoto(e.target.files?.[0] || null)}
        />
        {preview && <img className="photo-preview" src={preview} alt="Pregled" />}
      </div>
      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : 'Spremi lokaciju'}
      </button>
    </Modal>
  );
}

// ---------- Status montaže na gradilištu ----------
function SiteStatusModal({ jobId, item, onClose, onDone }: {
  jobId: number; item: JobItem; onClose: () => void; onDone: () => void;
}) {
  const [status, setStatus] = useState<SiteStatus | ''>(item.site_status || '');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!status) { setError('Odaberite status.'); return; }
    setBusy(true);
    try {
      await api.put(`/jobs/${jobId}/items/${item.id}/site-status`, { site_status: status, comment });
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Montaža — ${ITEM_LABEL[item.type]}`} onClose={onClose}>
      <ErrorBox msg={error} />
      <div className="field">
        <label>Status na gradilištu</label>
        <div className="btn-row" style={{ marginTop: 4 }}>
          {(Object.keys(SITE_LABEL) as SiteStatus[]).map((s) => (
            <button
              key={s}
              className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setStatus(s)}
            >{SITE_LABEL[s]}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Komentar (opcionalno)</label>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : 'Spremi status'}
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
        <input type="file" accept="image/*" capture="environment" onChange={(e) => pickPhoto(e.target.files?.[0] || null)} />
        {preview && <img className="photo-preview" src={preview} alt="Pregled" />}
      </div>
      <button className={`btn btn-block ${kind === 'problem' ? 'btn-danger' : 'btn-primary'}`} onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : 'Spremi'}
      </button>
    </Modal>
  );
}
