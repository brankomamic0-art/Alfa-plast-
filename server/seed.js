// Pokreni jednom nakon postavljanja baze:  npm run seed
// Kreira početne korisnike (preskače postojeće).
import bcrypt from 'bcryptjs';
import { pool, migrate, q, one } from './db.js';

const USERS = [
  { username: 'toni',  password: 'toni1234',  full_name: 'Toni',  role: 'admin' },
  { username: 'josip', password: 'josip1234', full_name: 'Josip', role: 'admin' },
  { username: 'iko',   password: 'iko1234',   full_name: 'Iko',   role: 'majstor' },
  { username: 'vozac', password: 'vozac1234', full_name: 'Vozač (primjer)', role: 'vozac' },
];

async function main() {
  await migrate();
  for (const u of USERS) {
    const exists = await one('SELECT id FROM users WHERE username = $1', [u.username]);
    if (exists) {
      console.log(`— ${u.username} već postoji, preskačem`);
      continue;
    }
    const hash = await bcrypt.hash(u.password, 10);
    await q(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES ($1,$2,$3,$4)',
      [u.username, hash, u.full_name, u.role]
    );
    console.log(`✔ Kreiran ${u.role}: ${u.username} / ${u.password}`);
  }
  console.log('\n⚠ VAŽNO: promijenite početne lozinke nakon prve prijave!');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
