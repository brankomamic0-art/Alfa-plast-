import { ReactNode } from 'react';
import {
  JobStatus, TaskStatus, VehicleStatus,
  JOB_STATUS_LABEL, TASK_STATUS_LABEL, VEHICLE_STATUS_LABEL,
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

export function VehicleBadge({ status }: { status: VehicleStatus }) {
  return <span className={`badge ${status === 'ispravno' ? 'b-green' : 'b-red'}`}>{VEHICLE_STATUS_LABEL[status]}</span>;
}
