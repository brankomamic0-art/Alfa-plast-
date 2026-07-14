import { useState } from 'react';
import { api } from '../api';
import { User, Role, ROLE_LABEL } from '../types';
import { Modal, ErrorBox } from './ui';

export default function Users({ users, onChanged }: { users: User[]; onChanged: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);

  return (
    <div>
      <button className="btn btn-primary btn-block" onClick={() => setShowCreate(true)}>
        + Novi korisnik
      </button>
      <div className="section-title">Korisnici</div>
      <div className="card">
        {users.map((u) => (
          <div key={u.id} className="switch-line">
            <div>
              <div className="nm">{u.full_name} {u.active === false && <span className="badge b-gray">Neaktivan</span>}</div>
              <div className="rl">@{u.username} · {ROLE_LABEL[u.role]}</div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => setEditUser(u)}>Uredi</button>
          </div>
        ))}
      </div>

      {showCreate && (
        <UserModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); onChanged(); }} />
      )}
      {editUser && (
        <UserModal user={editUser} onClose={() => setEditUser(null)} onDone={() => { setEditUser(null); onChanged(); }} />
      )}
    </div>
  );
}

function UserModal({ user, onClose, onDone }: { user?: User; onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = useState(user?.username || '');
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [role, setRole] = useState<Role>(user?.role || 'majstor');
  const [password, setPassword] = useState('');
  const [active, setActive] = useState(user?.active !== false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isEdit = !!user;

  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (isEdit) {
        await api.put(`/users/${user!.id}`, {
          full_name: fullName, role, active,
          ...(password ? { password } : {}),
        });
      } else {
        if (!username || !fullName || !password) {
          setError('Sva polja su obavezna.');
          setBusy(false);
          return;
        }
        await api.post('/users', { username, full_name: fullName, role, password });
      }
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={isEdit ? `Uredi: ${user!.full_name}` : 'Novi korisnik'} onClose={onClose}>
      <ErrorBox msg={error} />
      <div className="field">
        <label>Korisničko ime</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} disabled={isEdit} autoCapitalize="none" />
      </div>
      <div className="field">
        <label>Ime i prezime</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div className="field">
        <label>Uloga</label>
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="admin">Administrator</option>
          <option value="majstor">Majstor</option>
          <option value="vozac">Vozač</option>
        </select>
      </div>
      <div className="field">
        <label>{isEdit ? 'Nova lozinka (ostavite prazno za bez promjene)' : 'Lozinka'}</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {isEdit && (
        <label className="checkline">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Aktivan korisnik (može se prijaviti)
        </label>
      )}
      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
        {busy ? 'Spremanje…' : isEdit ? 'Spremi promjene' : 'Kreiraj korisnika'}
      </button>
    </Modal>
  );
}
