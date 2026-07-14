import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth } from '../auth.js';
import { vapidPublicKey, pushEnabled } from '../push.js';

const router = Router();

// ---- Javni VAPID ključ (za pushManager.subscribe na klijentu) ----
router.get('/push/public-key', requireAuth, (_req, res) => {
  res.json({ enabled: pushEnabled, key: vapidPublicKey || null });
});

// ---- Prijava uređaja na push obavijesti ----
router.post('/push/subscribe', requireAuth, async (req, res) => {
  const { endpoint, keys } = req.body?.subscription || req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Neispravna push pretplata.' });
  }
  await q(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
    [req.user.id, endpoint, keys.p256dh, keys.auth]
  );
  console.log(`[push] korisnik ${req.user.id} (${req.user.full_name}) pretplaćen: ${endpoint.slice(0, 60)}...`);
  res.status(201).json({ ok: true });
});

// ---- Odjava uređaja s push obavijesti ----
router.post('/push/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) await q('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  res.json({ ok: true });
});

export default router;
