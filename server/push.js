import webpush from 'web-push';
import { q } from './db.js';

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:info@alfaplast.hr';

export const pushEnabled = Boolean(publicKey && privateKey);

if (pushEnabled) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
} else {
  console.warn('⚠ VAPID ključevi nisu postavljeni — push obavijesti su isključene.');
}

export { publicKey as vapidPublicKey };

/** Pošalji push svim pretplatama danog korisnika; obriši pretplate koje su istekle/nevažeće. */
export async function sendPush(userId, payload) {
  if (!pushEnabled) return;
  const subs = await q('SELECT * FROM push_subscriptions WHERE user_id = $1', [userId]);
  if (subs.length === 0) return;

  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (sub) => {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(subscription, body);
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await q('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
        } else {
          console.error('Push greška:', e.message);
        }
      }
    })
  );
}
