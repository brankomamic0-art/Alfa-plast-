import { useEffect, useState } from 'react';
import { api } from '../api';
import { User, ROLE_LABEL } from '../types';
import { ErrorBox } from './ui';

export default function Settings({ me, users }: { me: User; users: User[] }) {
  const [muted, setMuted] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');

  useEffect(() => {
    api.get<number[]>('/mutes').then((ids) => {
      setMuted(new Set(ids));
      setLoaded(true);
    });
  }, []);

  async function toggleMute(userId: number) {
    const next = new Set(muted);
    const willMute = !next.has(userId);
    if (willMute) next.add(userId); else next.delete(userId);
    setMuted(next);
    try {
      await api.put(`/mutes/${userId}`, { muted: willMute });
    } catch {
      // vrati staro stanje ako ne uspije
      const revert = new Set(next);
      if (willMute) revert.delete(userId); else revert.add(userId);
      setMuted(revert);
    }
  }

  async function changePassword() {
    setPwMsg(''); setPwErr('');
    try {
      await api.put('/me/password', { old_password: oldPw, new_password: newPw });
      setPwMsg('Lozinka je promijenjena.');
      setOldPw(''); setNewPw('');
    } catch (e: any) {
      setPwErr(e.message);
    }
  }

  const others = users.filter((u) => u.id !== me.id && u.active !== false);

  return (
    <div>
      <div className="section-title">Obavijesti po korisniku</div>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Isključite prekidač da ne primate obavijesti od pojedinog korisnika.
        </p>
        {!loaded && <div className="muted">Učitavanje…</div>}
        {loaded && others.map((u) => {
          const isOn = !muted.has(u.id);
          return (
            <div key={u.id} className="switch-line">
              <div>
                <div className="nm">{u.full_name}</div>
                <div className="rl">{ROLE_LABEL[u.role]}</div>
              </div>
              <button
                className={`btn btn-sm ${isOn ? 'btn-green' : 'btn-ghost'}`}
                onClick={() => toggleMute(u.id)}
                aria-pressed={isOn}
              >
                {isOn ? '🔔 Uključeno' : '🔕 Utišano'}
              </button>
            </div>
          );
        })}
      </div>

      <div className="section-title">Promjena lozinke</div>
      <div className="card">
        {pwMsg && <div className="error-box" style={{ background: 'var(--green-bg)', color: 'var(--green)' }}>{pwMsg}</div>}
        <ErrorBox msg={pwErr} />
        <div className="field">
          <label>Stara lozinka</label>
          <input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
        </div>
        <div className="field">
          <label>Nova lozinka</label>
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        </div>
        <button className="btn btn-dark btn-block" onClick={changePassword}>Promijeni lozinku</button>
      </div>
    </div>
  );
}
