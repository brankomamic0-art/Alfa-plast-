import { useEffect, useState } from 'react';
import { api } from '../api';
import { Task, TaskComment, User, TASK_STATUS_LABEL, fmtDate, fmtDateTime } from '../types';
import { Modal, ErrorBox, TaskBadge } from './ui';

export default function Tasks({ me, users, refreshKey }: { me: User; users: User[]; refreshKey: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const isAdmin = me.role === 'admin';

  async function load() {
    setTasks(await api.get<Task[]>('/tasks'));
  }
  useEffect(() => { load(); }, [refreshKey]);

  const active = tasks.filter((t) => t.status !== 'zavrseno');
  const done = tasks.filter((t) => t.status === 'zavrseno');

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
        <CreateTaskModal
          users={users}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
      {openTask && (
        <TaskDetailModal
          task={openTask}
          me={me}
          onClose={() => setOpenTask(null)}
          onChanged={() => load()}
        />
      )}
    </div>
  );
}

function TaskCard({ task, isAdmin, onOpen }: { task: Task; isAdmin: boolean; onOpen: () => void }) {
  return (
    <div className="card clickable" onClick={onOpen} role="button">
      <div className="spread">
        <div>
          <h3>{task.auto_reminder ? '⏰ ' : ''}{task.title}</h3>
          <div className="muted">
            {isAdmin ? <>Za: <b>{task.assigned_name}</b> · </> : null}
            Od: {task.creator_name}
            {task.due_date ? <> · Rok: {fmtDate(task.due_date)}</> : null}
            {task.comment_count ? <> · 💬 {task.comment_count}</> : null}
          </div>
        </div>
        <TaskBadge status={task.status} />
      </div>
    </div>
  );
}

function CreateTaskModal({ users, onClose, onCreated }: { users: User[]; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState<number>(0);
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activeUsers = users.filter((u) => u.active !== false);

  async function submit() {
    if (!title.trim() || !assignedTo) {
      setError('Naslov i osoba su obavezni.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/tasks', { title, description, assigned_to: assignedTo, due_date: dueDate || null });
      onCreated();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Novi zadatak" onClose={onClose}>
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
        <label>Dodijeli osobi *</label>
        <select value={assignedTo} onChange={(e) => setAssignedTo(Number(e.target.value))}>
          <option value={0}>— odaberi —</option>
          {activeUsers.map((u) => (
            <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Rok (opcionalno)</label>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </div>
      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : 'Kreiraj zadatak'}
      </button>
    </Modal>
  );
}

function TaskDetailModal({ task, me, onClose, onChanged }: { task: Task; me: User; onClose: () => void; onChanged: () => void }) {
  const [current, setCurrent] = useState<Task>(task);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [error, setError] = useState('');
  const isAdmin = me.role === 'admin';
  const isMine = current.assigned_to === me.id;

  useEffect(() => {
    api.get<TaskComment[]>(`/tasks/${task.id}/comments`).then(setComments).catch(() => {});
  }, [task.id]);

  async function setStatus(status: string) {
    try {
      const updated = await api.put<Task>(`/tasks/${task.id}/status`, { status });
      setCurrent({ ...current, status: updated.status });
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
    <Modal title={current.title} onClose={onClose}>
      <div className="row" style={{ marginBottom: 10 }}>
        <TaskBadge status={current.status} />
        {current.due_date && <span className="chip">Rok: {fmtDate(current.due_date)}</span>}
      </div>
      <div className="muted" style={{ marginBottom: 6 }}>
        Za: <b>{current.assigned_name}</b> · Kreirao: {current.creator_name} · {fmtDateTime(current.created_at)}
      </div>
      {current.description && <p style={{ whiteSpace: 'pre-wrap' }}>{current.description}</p>}
      <ErrorBox msg={error} />

      <div className="btn-row">
        {isMine && current.status === 'poslano' && (
          <button className="btn btn-primary" onClick={() => setStatus('primljeno')}>▶ Preuzmi zadatak</button>
        )}
        {isMine && current.status === 'primljeno' && (
          <button className="btn btn-green" onClick={() => setStatus('zavrseno')}>✔ Označi završeno</button>
        )}
        {isAdmin && (
          <>
            <select
              value={current.status}
              onChange={(e) => setStatus(e.target.value)}
              style={{ padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--line)', fontWeight: 700 }}
            >
              {(['poslano', 'primljeno', 'zavrseno'] as const).map((s) => (
                <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>
              ))}
            </select>
            <button className="btn btn-danger" onClick={remove}>Obriši</button>
          </>
        )}
      </div>

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
    </Modal>
  );
}
