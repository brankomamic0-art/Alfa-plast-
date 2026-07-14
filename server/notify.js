import { q } from './db.js';

/**
 * Kreira obavijesti za listu primatelja, poštujući utišavanja.
 * - Ne šalje obavijest samom akteru.
 * - Ne šalje ako je primatelj utišao aktera (osim za automatske podsjetnike, actorId=null).
 */
export async function notify({ recipients, actorId = null, type, title, body = '', refType = null, refId = null }) {
  const unique = [...new Set(recipients)].filter((id) => id && id !== actorId);
  if (unique.length === 0) return;

  let allowed = unique;
  if (actorId) {
    const muted = await q(
      'SELECT user_id FROM notification_mutes WHERE muted_user_id = $1 AND user_id = ANY($2::int[])',
      [actorId, unique]
    );
    const mutedSet = new Set(muted.map((m) => m.user_id));
    allowed = unique.filter((id) => !mutedSet.has(id));
  }
  if (allowed.length === 0) return;

  const values = [];
  const params = [];
  allowed.forEach((uid, i) => {
    const base = i * 7;
    values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`);
    params.push(uid, actorId, type, title, body, refType, refId);
  });
  await q(
    `INSERT INTO notifications (user_id, actor_id, type, title, body, ref_type, ref_id) VALUES ${values.join(',')}`,
    params
  );
}

/** Svi aktivni korisnici (id-evi), opcionalno filtrirano po ulogama. */
export async function userIds(roles = null) {
  const rows = roles
    ? await q('SELECT id FROM users WHERE active = TRUE AND role = ANY($1::text[])', [roles])
    : await q('SELECT id FROM users WHERE active = TRUE');
  return rows.map((r) => r.id);
}
