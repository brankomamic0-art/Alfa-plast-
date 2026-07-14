import { ReactNode } from 'react';
import {
  ItemStatus, SiteStatus, ItemLocation, JobStatus, TaskStatus,
  ITEM_STATUS_LABEL, SITE_LABEL, LOCATION_LABEL, JOB_STATUS_LABEL, TASK_STATUS_LABEL,
} from '../types';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="close-x" onClick={onClose} aria-label="Zatvori">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorBox({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div className="error-box">{msg}</div>;
}

const TASK_BADGE: Record<TaskStatus, string> = { poslano: 'b-blue', primljeno: 'b-amber', zavrseno: 'b-green' };
export function TaskBadge({ status }: { status: TaskStatus }) {
  return <span className={`badge ${TASK_BADGE[status]}`}>{TASK_STATUS_LABEL[status]}</span>;
}

const JOB_BADGE: Record<JobStatus, string> = {
  u_pripremi: 'b-gray', spremno_za_montazu: 'b-orange', u_tijeku: 'b-amber', zavrseno: 'b-green',
};
export function JobBadge({ status }: { status: JobStatus }) {
  return <span className={`badge ${JOB_BADGE[status]}`}>{JOB_STATUS_LABEL[status]}</span>;
}

const ITEM_BADGE: Record<ItemStatus, string> = { naruceno: 'b-gray', u_izradi: 'b-amber', spremno_za_montazu: 'b-orange' };
export function ItemStatusBadge({ status }: { status: ItemStatus }) {
  return <span className={`badge ${ITEM_BADGE[status]}`}>{ITEM_STATUS_LABEL[status]}</span>;
}

export function LocationBadge({ location }: { location: ItemLocation | null }) {
  if (!location) return null;
  const cls = location === 'na_gradilistu' ? 'b-amber' : location === 'ispred_firme' ? 'b-blue' : 'b-purple';
  return <span className={`badge ${cls}`}>📍 {LOCATION_LABEL[location]}</span>;
}

export function SiteBadge({ status }: { status: SiteStatus | null }) {
  if (!status) return null;
  const cls = status === 'zavrseno' ? 'b-green' : status === 'namontirano' ? 'b-green' : 'b-amber';
  return <span className={`badge ${cls}`}>🔧 {SITE_LABEL[status]}</span>;
}

/** Lanac napretka stavke: priprema (3) + transport + montaža */
export function ItemChain({ status, location, site }: { status: ItemStatus; location: ItemLocation | null; site: SiteStatus | null }) {
  const prep = ['naruceno', 'u_izradi', 'spremno_za_montazu'].indexOf(status) + 1;
  const transported = location ? 1 : 0;
  const mounted = site === 'namontirano' || site === 'zavrseno' ? 1 : 0;
  const finished = site === 'zavrseno';
  const segs = [prep >= 1, prep >= 2, prep >= 3, transported === 1, mounted === 1];
  return (
    <div className="chain" aria-hidden>
      {segs.map((on, i) => (
        <span key={i} className={on ? (finished ? 'final' : 'done') : ''} />
      ))}
    </div>
  );
}
