import { useState } from 'react';
import { api, storeSession } from '../api';
import { User } from '../types';
import { ErrorBox } from './ui';

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!username || !password) {
      setError('Unesite korisničko ime i lozinku.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ token: string; user: User }>('/login', { username, password });
      storeSession(res.token, res.user);
      onLogin(res.user);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">Alfa Plast</div>
        <div className="login-sub">Praćenje poslova i montaže</div>
        <ErrorBox msg={error} />
        <div className="field">
          <label>Korisničko ime</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoComplete="username"
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        <div className="field">
          <label>Lozinka</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
          {busy ? 'Prijava…' : 'Prijavi se'}
        </button>
      </div>
    </div>
  );
}
