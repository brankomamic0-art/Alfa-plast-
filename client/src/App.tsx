import { useCallback, useEffect, useState } from 'react';
import { api, getStoredUser, getToken, clearSession } from './api';
import { User, Notification, ROLE_LABEL } from './types';
import Login from './components/Login';
import Tasks from './components/Tasks';
import Jobs from './components/Jobs';
import JobDetail from './components/JobDetail';
import Users from './components/Users';
import Settings from './components/Settings';
import NotificationsPanel from './components/Notifications';
import { resyncPushSubscription } from './push';

type Tab = 'zadaci' | 'baustele' | 'korisnici' | 'postavke';

export default function App() {
  const [me, setMe] = useState<User | null>(() => (getToken() ? getStoredUser<User>() : null));
  const [tab, setTab] = useState<Tab>('baustele');
  const [openJobId, setOpenJobId] = useState<number | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [showNotifs, setShowNotifs] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  // automatska odjava kad token istekne
  useEffect(() => {
    const handler = () => setMe(null);
    window.addEventListener('ap-logout', handler);
    return () => window.removeEventListener('ap-logout', handler);
  }, []);

  // učitaj korisnike (za dodjelu zadataka, mute liste…)
  useEffect(() => {
    if (!me) return;
    api.get<User[]>('/users').then(setUsers).catch(() => {});
  }, [me, refreshKey]);

  // ako uređaj već ima push pretplatu, provjeri da je server stvarno ima spremljenu
  useEffect(() => {
    if (!me) return;
    resyncPushSubscription();
  }, [me]);

  // polling obavijesti svakih 20s
  useEffect(() => {
    if (!me) return;
    let stop = false;
    async function poll() {
      try {
        const res = await api.get<{ notifications: Notification[]; unread: number }>('/notifications');
        if (!stop) {
          setNotifications(res.notifications);
          setUnread(res.unread);
        }
      } catch { /* ignoriraj */ }
    }
    poll();
    const id = setInterval(poll, 20000);
    return () => { stop = true; clearInterval(id); };
  }, [me, refreshKey]);

  function logout() {
    clearSession();
    setMe(null);
  }

  async function readAll() {
    await api.put('/notifications/read-all');
    setUnread(0);
    setNotifications(notifications.map((n) => ({ ...n, read: true })));
  }

  function openRef(refType: 'task' | 'job', refId: number) {
    if (refType === 'job') {
      setTab('baustele');
      setOpenJobId(refId);
    } else {
      setTab('zadaci');
      setOpenJobId(null);
    }
    bump();
  }

  if (!me) return <Login onLogin={(u) => { setMe(u); setTab(u.role === 'admin' ? 'zadaci' : 'baustele'); }} />;

  const isAdmin = me.role === 'admin';
  const tabs: { key: Tab; label: string }[] = [
    { key: 'zadaci', label: 'Zadaci' },
    { key: 'baustele', label: 'Bauštele' },
    ...(isAdmin ? [{ key: 'korisnici' as Tab, label: 'Korisnici' }] : []),
    { key: 'postavke', label: 'Postavke' },
  ];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <b>Alfa Plast</b>
          <small>{me.full_name} · {ROLE_LABEL[me.role]}</small>
        </div>
        <div className="right">
          <button className="bell" onClick={() => setShowNotifs(true)} aria-label="Obavijesti">
            🔔
            {unread > 0 && <span className="dot">{unread > 99 ? '99+' : unread}</span>}
          </button>
          <button className="logout-btn" onClick={logout}>Odjava</button>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => { setTab(t.key); if (t.key !== 'baustele') setOpenJobId(null); }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'zadaci' && <Tasks me={me} users={users} refreshKey={refreshKey} />}
        {tab === 'baustele' && (
          openJobId
            ? <JobDetail jobId={openJobId} me={me} onBack={() => { setOpenJobId(null); bump(); }} onChanged={bump} />
            : <Jobs me={me} refreshKey={refreshKey} onOpenJob={setOpenJobId} />
        )}
        {tab === 'korisnici' && isAdmin && <Users users={users} onChanged={bump} />}
        {tab === 'postavke' && <Settings me={me} users={users} />}
      </main>

      {showNotifs && (
        <NotificationsPanel
          notifications={notifications}
          onClose={() => setShowNotifs(false)}
          onReadAll={readAll}
          onOpenRef={openRef}
        />
      )}
    </div>
  );
}
