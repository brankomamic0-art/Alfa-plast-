import { api } from './api';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/**
 * Ponovno pošalji postojeću pretplatu na server ako je lokalno prisutna.
 * Sanira slučaj kad je subscribe() na uređaju uspio, ali je spremanje na
 * server ranije palo (npr. kratki prekid mreže) — bez ovoga app izgleda
 * "uključeno" iako server nikad nije dobio pretplatu.
 */
export async function resyncPushSubscription(): Promise<boolean> {
  const sub = await getPushSubscription();
  if (!sub) return false;
  try {
    await api.post('/push/subscribe', { subscription: sub.toJSON() });
    return true;
  } catch {
    return false;
  }
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('Push obavijesti nisu podržane na ovom uređaju/pregledniku.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Dozvola za obavijesti nije odobrena.');

  const { enabled, key } = await api.get<{ enabled: boolean; key: string | null }>('/push/public-key');
  if (!enabled || !key) throw new Error('Push obavijesti trenutno nisu konfigurirane na serveru.');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer,
    });
  }
  await api.post('/push/subscribe', { subscription: sub.toJSON() });
}

export async function disablePush(): Promise<void> {
  const sub = await getPushSubscription();
  if (!sub) return;
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}
