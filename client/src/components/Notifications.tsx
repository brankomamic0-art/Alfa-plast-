import { api } from '../api';
import { Notification, fmtDateTime } from '../types';
import { Modal } from './ui';

export default function NotificationsPanel({ notifications, onClose, onReadAll, onOpenRef }: {
  notifications: Notification[];
  onClose: () => void;
  onReadAll: () => void;
  onOpenRef: (refType: 'task' | 'job', refId: number) => void;
}) {
  async function open(n: Notification) {
    if (!n.read) {
      api.put(`/notifications/${n.id}/read`).catch(() => {});
    }
    if (n.ref_type && n.ref_id) {
      onOpenRef(n.ref_type, n.ref_id);
    }
    onClose();
  }

  return (
    <Modal title="Obavijesti" onClose={onClose}>
      {notifications.length > 0 && (
        <button className="btn btn-sm btn-ghost" onClick={onReadAll} style={{ marginBottom: 8 }}>
          Označi sve pročitano
        </button>
      )}
      {notifications.length === 0 && <div className="empty">Nemate obavijesti.</div>}
      {notifications.map((n) => (
        <div key={n.id} className={`notif ${n.read ? '' : 'unread'}`} onClick={() => open(n)} role="button" style={{ cursor: 'pointer' }}>
          <div className="nd" />
          <div>
            <b>{n.title}</b>
            {n.body && <p>{n.body}</p>}
            <p style={{ fontSize: 11.5 }}>{fmtDateTime(n.created_at)}</p>
          </div>
        </div>
      ))}
    </Modal>
  );
}
