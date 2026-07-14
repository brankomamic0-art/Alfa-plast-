export type Role = 'admin' | 'majstor' | 'vozac';

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  active?: boolean;
}

export type TaskStatus = 'poslano' | 'primljeno' | 'zavrseno';

export interface Task {
  id: number;
  title: string;
  description: string;
  assigned_to: number;
  created_by: number;
  status: TaskStatus;
  due_date: string | null;
  job_id: number | null;
  auto_reminder: boolean;
  created_at: string;
  assigned_name?: string;
  creator_name?: string;
  comment_count?: number;
}

export interface TaskComment {
  id: number;
  task_id: number;
  user_id: number;
  body: string;
  created_at: string;
  full_name: string;
}

export type ItemType = 'profili' | 'staklo' | 'spideri';
export type ItemStatus = 'naruceno' | 'u_izradi' | 'spremno_za_montazu';
export type ItemLocation = 'ispred_firme' | 'caporice' | 'nedo' | 'na_gradilistu';
export type SiteStatus = 'na_gradilistu' | 'namontirano' | 'zavrseno';
export type JobStatus = 'u_pripremi' | 'spremno_za_montazu' | 'u_tijeku' | 'zavrseno';

export interface JobItem {
  id: number;
  job_id?: number;
  type: ItemType;
  status: ItemStatus;
  location: ItemLocation | null;
  site_status: SiteStatus | null;
}

export interface JobEvent {
  id: number;
  job_id: number;
  item_id: number | null;
  user_id: number;
  kind: 'komentar' | 'status' | 'transport' | 'problem' | 'napredak' | 'napomena' | 'fotografija';
  body: string;
  photo_path: string | null;
  created_at: string;
  full_name: string;
}

export interface Job {
  id: number;
  name: string;
  address: string;
  note: string;
  category: string;
  status: JobStatus;
  planned_date: string | null;
  created_by: number;
  creator_name?: string;
  archived: boolean;
  updated_at: string;
  items: JobItem[];
  events?: JobEvent[];
}

export interface Notification {
  id: number;
  actor_id: number | null;
  actor_name: string | null;
  type: string;
  title: string;
  body: string;
  ref_type: 'task' | 'job' | null;
  ref_id: number | null;
  read: boolean;
  created_at: string;
}

// ---------- Rječnici ----------
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrator',
  majstor: 'Majstor',
  vozac: 'Vozač',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  poslano: 'Poslano',
  primljeno: 'Primljeno',
  zavrseno: 'Završeno',
};

export const ITEM_LABEL: Record<ItemType, string> = {
  profili: 'Profili',
  staklo: 'Staklo',
  spideri: 'Spideri',
};

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  naruceno: 'Naručeno',
  u_izradi: 'U izradi',
  spremno_za_montazu: 'Spremno za montažu',
};

export const LOCATION_LABEL: Record<ItemLocation, string> = {
  ispred_firme: 'Ispred firme',
  caporice: 'Skladište Čaporice',
  nedo: 'Skladište Nedo',
  na_gradilistu: 'Na gradilištu',
};

export const SITE_LABEL: Record<SiteStatus, string> = {
  na_gradilistu: 'Na gradilištu',
  namontirano: 'Namontirano',
  zavrseno: 'Završeno',
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  u_pripremi: 'U pripremi',
  spremno_za_montazu: 'Spremno za montažu',
  u_tijeku: 'U tijeku',
  zavrseno: 'Završeno',
};

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('hr-HR');
}

export function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString('hr-HR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
