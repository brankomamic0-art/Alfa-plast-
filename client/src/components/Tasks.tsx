import { useEffect, useState } from 'react';
import { api } from '../api';
import {
  Task, TaskComment, TaskStatus, User, Vehicle,
  TASK_STATUS_LABEL, VEHICLE_STATUS_LABEL, fmtDate, fmtDateTime, toDateInput,
} from '../types';
import { Modal, ErrorBox, TaskBadge } from './ui';

export default function Tasks({ me, users, vehicles, refreshKey }: { me: User; users: User[]; vehicles: Vehicle[]; refreshKey: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const isAdmin = me.role === 'admin';

  async function load() {
    const rows = await api.get<Task[]>('/tasks');
    setTasks(rows);
    setOpenTask((cur) => (cur ? rows.find((t) => t.id === cur.id) || null : null));
  }
  useEffect(() => { load(); }, [refreshKey]);

  // Za izvršitelja je zadatak "gotov" kad je on svoj dio završio
  const isDone = (t: Task) => (t.my_status ? t.my_status === 'zavrseno' : t.status === 'zavrseno');
  const active = tasks.filter((t) => !isDone(t));
  const done = tasks.filter(isDone);

  return (
    <div>
      {isAdmin && (
        <button className="btn btn-primary btn-block" onClick={() => setShowCreate(true)}>
          + Novi zadatak
        </button>
      )}

      <div className="section-title">Aktivni zadaci</div>
      {active.length === 0 && <div className="empty">Nema aktivnih zadataka.</div>}
      {active.map((t) => (
        <TaskCard key={t.id} task={t} isAdmin={isAdmin} onOpen={() => setOpenTask(t)} />
      ))}

      {done.length > 0 && (
        <>
          <div className="section-title">Završeno</div>
          {done.map((t) => (
            <TaskCard key={t.id} task={t} isAdmin={isAdmin} onOpen={() => setOpenTask(t)} />
          ))}
        </>
      )}

      {showCreate && (
        <TaskModal
          users={users}
          vehicles={vehicles}
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); load(); }}
        />
      )}
      {openTask && (
        <TaskDetailModal
          task={openTask}
          me={me}
          users={users}
          vehicles={vehicles}
          onClose={() => setOpenTask(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

const ASSIGNEE_BADGE: Record<TaskStatus, string> = { poslano: 'b-blue', primljeno: 'b-amber', zavrseno: 'b-green' };

function TaskCard({ task, isAdmin, onOpen }: { task: Task; isAdmin: boolean; onOpen: () => void }) {
  const people = task.assignees || [];
  const doneCount = people.filter((a) => a.status === 'zavrseno').length;
  return (
    <div className="card clickable" onClick={onOpen} role="button">
      <div className="spread">
        <div>
          <h3>{task.auto_reminder ? '⏰ ' : ''}{task.title}</h3>
          <div className="muted">
            Od: {task.creator_name}
            {task.due_date ? <> · Rok: {fmtDate(task.due_date)}</> : null}
            {task.vehicle_registration ? <> · 🚗 {task.vehicle_registration}</> : null}
            {task.comment_count ? <> · 💬 {task.comment_count}</> : null}
          </div>
        </div>
        <TaskBadge status={task.status} />
      </div>

      {/* Tko sve radi na zadatku — svatko sa svojim statusom */}
      {(isAdmin || people.length > 1) && people.length > 0 && (
        <div className="row" style={{ marginTop: 8 }}>
          {people.length > 1 && (
            <span className="chip">👥 {doneCount}/{people.length} završilo</span>
          )}
          {people.map((a) => (
            <span key={a.user_id} className={`badge ${ASSIGNEE_BADGE[a.status]}`}>{a.full_name}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================
// Kreiranje / uređivanje zadatka (admin) — više izvršitelja
// =====================================================
function TaskModal({ task, users, vehicles, onClose, onDone }: {
  task?: Task; users: User[]; vehicles: Vehicle[]; onClose: () => void; onDone: () => void;
}) {
  const isEdit = !!task;
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [selected, setSelected] = useState<number[]>(task ? (task.assignees || []).map((a) => a.user_id) : []);
  const [vehicleId, setVehicleId] = useState<number>(task?.vehicle_id || 0);
  const [dueDate, setDueDate] = useState(toDateInput(task?.due_date));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const activeUsers = users.filter((u) => u.active !== false);
  const showVehiclePicker = activeUsers.some((u) => selected.includes(u.id) && u.role === 'vozac');
  const availableVehicles = vehicles.filter((v) => v.active !== false);

  function toggle(id: number) {
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  async function submit() {
    if (!title.trim()) { setError('Naslov je obavezan.'); return; }
    if (selected.length === 0) { setError('Odaberite barem jednu osobu.'); return; }
    setBusy(true);
    setError('');
    try {
      const payload = {
        title,
        description,
        assignee_ids: selected,
        due_date: dueDate || null,
        vehicle_id: showVehiclePicker && vehicleId ? vehicleId : null,
      };
      if (isEdit) await api.put(`/tasks/${task!.id}`, payload);
      else await api.post('/tasks', payload);
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Uredi zadatak' : 'Novi zadatak'} onClose={onClose}>
      <ErrorBox msg={error} />
      <div className="field">
        <label>Naslov *</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="npr. Naručiti materijale iz Feala" />
      </div>
      <div className="field">
        <label>Opis</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="field">
        <label>Dodijeli osobama * {selected.length > 0 && `(${selected.length})`}</label>
        {activeUsers.map((u) => (
          <label key={u.id} className="checkline">
            <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
            {u.full_name} <span className="chip">{u.role}</span>
          </label>
        ))}
        <div className="muted" style={{ marginTop: 4 }}>
          Može ih se odabrati više — svatko vodi svoj status (Poslano → Primljeno → Završeno).
        </div>
      </div>

      {showVehiclePicker && (
        <div className="field">
          <label>Vozilo (opcionalno)</label>
          <select value={vehicleId} onChange={(e) => setVehicleId(Number(e.target.value))}>
            <option value={0}>— bez vozila —</option>
            {availableVehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration}{v.name ? ` — ${v.name}` : ''} ({VEHICLE_STATUS_LABEL[v.status]})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label>Rok (opcionalno)</label>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </div>

      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : isEdit ? 'Spremi promjene' : 'Kreiraj zadatak'}
      </button>
    </Modal>
  );
}

// =====================================================
// Detalj zadatka
// =====================================================
function TaskDetailModal({ task, me, users, vehicles, onClose, onChanged }: {
  task: Task; me: User; users: User[]; vehicles: Vehicle[]; onClose: () => void; onChanged: () => void;
}) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [error, setError] = useState('');
  const isAdmin = me.role === 'admin';
  const people = task.assignees || [];
  const myStatus = task.my_status;

  useEffect(() => {
    api.get<TaskComment[]>(`/tasks/${task.id}/comments`).then(setComments).catch(() => {});
  }, [task.id]);

  /** Bez `userId` admin mijenja status svima; s njim samo toj osobi. */
  async function setStatus(status: TaskStatus, userId?: number) {
    try {
      await api.put(`/tasks/${task.id}/status`, { status, user_id: userId ?? null });
      onChanged();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function addComment() {
    if (!newComment.trim()) return;
    try {
      const c = await api.post<TaskComment>(`/tasks/${task.id}/comments`, { body: newComment });
      setComments([...comments, c]);
      setNewComment('');
      onChanged();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function remove() {
    if (!confirm('Obrisati ovaj zadatak?')) return;
    await api.del(`/tasks/${task.id}`);
    onChanged();
    onClose();
  }

  return (
    <Modal title={task.title} onClose={onClose}>
      <div className="row" style={{ marginBottom: 10 }}>
        <TaskBadge status={task.status} />
        {task.due_date && <span className="chip">Rok: {fmtDate(task.due_date)}</span>}
        {task.vehicle_registration && <span className="chip">🚗 {task.vehicle_registration}</span>}
      </div>
      <div className="muted" style={{ marginBottom: 6 }}>
        Kreirao: {task.creator_name} · {fmtDateTime(task.created_at)}
      </div>
      {task.description && <p style={{ whiteSpace: 'pre-wrap' }}>{task.description}</p>}
      <ErrorBox msg={error} />

      {/* Moje akcije */}
      <div className="btn-row">
        {myStatus === 'poslano' && (
          <button className="btn btn-primary" onClick={() => setStatus('primljeno')}>▶ Preuzmi zadatak</button>
        )}
        {myStatus === 'primljeno' && (
          <button className="btn btn-green" onClick={() => setStatus('zavrseno')}>✔ Označi završeno</button>
        )}
        {isAdmin && (
          <>
            <button className="btn btn-ghost" onClick={() => setShowEdit(true)}>Uredi</button>
            <button className="btn btn-danger" onClick={remove}>Obriši</button>
          </>
        )}
      </div>

      {/* Tko radi na zadatku — admin može mijenjati status pojedincu */}
      <div className="section-title">
        Dodijeljeno {people.length > 1 && `(${people.length})`}
      </div>
      {people.length === 0 && <div className="muted">Nema dodijeljenih osoba.</div>}
      {people.map((a) => (
        <div key={a.user_id} className="switch-line">
          <div>
            <div className="nm">{a.full_name}{a.user_id === me.id && ' (vi)'}</div>
            <div className="rl">{TASK_STATUS_LABEL[a.status]}</div>
          </div>
          {isAdmin ? (
            <select
              value={a.status}
              onChange={(e) => setStatus(e.target.value as TaskStatus, a.user_id)}
              style={{ padding: '8px 10px', borderRadius: 9, border: '1.5px solid var(--line)', fontWeight: 700 }}
            >
              {(['poslano', 'primljeno', 'zavrseno'] as TaskStatus[]).map((s) => (
                <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>
              ))}
            </select>
          ) : (
            <TaskBadge status={a.status} />
          )}
        </div>
      ))}

      <div className="section-title">Komentari</div>
      {comments.length === 0 && <div className="muted" style={{ marginBottom: 8 }}>Još nema komentara.</div>}
      {comments.map((c) => (
        <div key={c.id} className="event">
          <span className="who">{c.full_name}</span> <span className="when">{fmtDateTime(c.created_at)}</span>
          <div className="body">{c.body}</div>
        </div>
      ))}
      <div className="field" style={{ marginTop: 10 }}>
        <textarea
          placeholder="npr. rok čekanja, staklo dolazi 27.7…"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
        />
      </div>
      <button className="btn btn-dark btn-block" onClick={addComment}>Dodaj komentar</button>

      {showEdit && (
        <TaskModal
          task={task}
          users={users}
          vehicles={vehicles}
          onClose={() => setShowEdit(false)}
          onDone={() => { setShowEdit(false); onChanged(); }}
        />
      )}
    </Modal>
  );
}
