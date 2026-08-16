-- =====================================================
-- ALFA PLAST — Praćenje poslova
-- PostgreSQL shema
-- =====================================================

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','majstor','vozac')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ VOZILA ============
CREATE TABLE IF NOT EXISTS vehicles (
  id           SERIAL PRIMARY KEY,
  registration TEXT NOT NULL UNIQUE,        -- tablica (npr. T12-A-345)
  name         TEXT DEFAULT '',             -- opcionalno: model/oznaka
  status       TEXT NOT NULL DEFAULT 'ispravno' CHECK (status IN ('ispravno','u_kvaru')),
  note         TEXT DEFAULT '',             -- npr. opis kvara
  active       BOOLEAN NOT NULL DEFAULT TRUE, -- "obrisano" bez gubitka povijesti u zadacima
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Kvarovi vozila: više otvorenih kvarova po vozilu, prijaviti može bilo koja uloga.
-- Status vozila izvodi se iz ove tablice (postoji li ijedan neriješen kvar).
CREATE TABLE IF NOT EXISTS vehicle_faults (
  id           SERIAL PRIMARY KEY,
  vehicle_id   INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  reported_by  INTEGER NOT NULL REFERENCES users(id),
  description  TEXT NOT NULL DEFAULT '',
  resolved     BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by  INTEGER REFERENCES users(id),
  resolved_at  TIMESTAMPTZ,
  resolve_note TEXT DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_faults ON vehicle_faults(vehicle_id, resolved, created_at DESC);

-- Servisna povijest vozila. Unosi isključivo administrator.
-- Zapisi tipa 'ulje' vidljivi su svima; 'registracija' i 'tehnicki' samo administratoru.
CREATE TABLE IF NOT EXISTS vehicle_service_records (
  id          SERIAL PRIMARY KEY,
  vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('ulje','registracija','tehnicki')),
  done_date   DATE NOT NULL,          -- kad je obavljeno
  valid_until DATE,                   -- vrijedi do (registracija / tehnički)
  odometer    INTEGER,                -- stanje km (izmjena ulja)
  next_odometer INTEGER,              -- na kojoj kilometraži je iduća izmjena ulja
  note        TEXT DEFAULT '',
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE vehicle_service_records ADD COLUMN IF NOT EXISTS next_odometer INTEGER;
CREATE INDEX IF NOT EXISTS idx_vehicle_service ON vehicle_service_records(vehicle_id, type, done_date DESC);

-- Prijenos zatečenih kvarova (status 'u_kvaru' + napomena) u tablicu kvarova
INSERT INTO vehicle_faults (vehicle_id, reported_by, description, created_at)
SELECT v.id,
       (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1),
       COALESCE(NULLIF(v.note, ''), 'Prijavljen kvar'),
       v.updated_at
FROM vehicles v
WHERE v.status = 'u_kvaru'
  AND NOT EXISTS (SELECT 1 FROM vehicle_faults f WHERE f.vehicle_id = v.id)
  AND EXISTS (SELECT 1 FROM users WHERE role = 'admin');

-- Napomena je prenesena u kvar, briše se s vozila da se ne prikazuje dvaput
UPDATE vehicles v SET note = ''
WHERE v.status = 'u_kvaru'
  AND NULLIF(v.note, '') IS NOT NULL
  AND EXISTS (SELECT 1 FROM vehicle_faults f WHERE f.vehicle_id = v.id AND f.description = v.note);

-- ============ TO-DO LISTA ============
-- Statusi: poslano (admin kreirao) -> primljeno (korisnik preuzeo) -> zavrseno
CREATE TABLE IF NOT EXISTS tasks (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  assigned_to   INTEGER NOT NULL REFERENCES users(id),
  created_by    INTEGER NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'poslano'
                CHECK (status IN ('poslano','primljeno','zavrseno')),
  due_date      DATE,
  job_id        INTEGER,                -- opcionalna veza na bauštelu
  vehicle_id    INTEGER REFERENCES vehicles(id) ON DELETE SET NULL, -- opcionalno: vozilo dodijeljeno uz zadatak (vozači)
  auto_reminder BOOLEAN NOT NULL DEFAULT FALSE, -- true = automatski podsjetnik iz bauštele
  last_reminded TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS task_comments (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ BAUŠTELE (poslovi) ============
CREATE TABLE IF NOT EXISTS jobs (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,            -- ime bauštele
  address      TEXT DEFAULT '',
  note         TEXT DEFAULT '',
  category     TEXT NOT NULL DEFAULT 'staklene_ograde'
               CHECK (category IN ('staklene_ograde','pvc_stolarija','alu_stolarija')),
  status       TEXT NOT NULL DEFAULT 'u_pripremi'
               CHECK (status IN ('u_pripremi','spremno_za_montazu','u_tijeku','zavrseno')),
  planned_date DATE,                     -- planirani datum montaže
  reminder_sent BOOLEAN NOT NULL DEFAULT FALSE, -- podsjetnik ubačen u to-do
  created_by   INTEGER NOT NULL REFERENCES users(id),
  archived     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stavke bauštele: profili / staklo / spideri (sve opcionalno, bira se pri kreiranju)
CREATE TABLE IF NOT EXISTS job_items (
  id          SERIAL PRIMARY KEY,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('profili','staklo','spideri')),
  -- uredski status pripreme
  status      TEXT NOT NULL DEFAULT 'naruceno'
              CHECK (status IN ('naruceno','u_izradi','spremno_za_montazu')),
  -- transport lokacija (postavljaju vozači/majstori/admin)
  location    TEXT CHECK (location IN ('ispred_firme','caporice','nedo','na_gradilistu')),
  -- status na gradilištu
  site_status TEXT CHECK (site_status IN ('na_gradilistu','namontirano','zavrseno')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Svi događaji na bauštelama: komentari, promjene statusa, transport, problemi,
-- dnevni napredak, napomene za sljedeću ekipu, fotografije
CREATE TABLE IF NOT EXISTS job_events (
  id         SERIAL PRIMARY KEY,
  job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  item_id    INTEGER REFERENCES job_items(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL CHECK (kind IN
             ('komentar','status','transport','problem','napredak','napomena','fotografija')),
  body       TEXT DEFAULT '',
  photo_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ OBAVIJESTI ============
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- primatelj
  actor_id   INTEGER REFERENCES users(id),                            -- tko je izazvao
  type       TEXT NOT NULL,   -- npr. task_novi, task_status, job_status, transport, problem, podsjetnik...
  title      TEXT NOT NULL,
  body       TEXT DEFAULT '',
  ref_type   TEXT,            -- 'task' | 'job'
  ref_id     INTEGER,
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);

-- Utišavanje obavijesti po korisniku: user_id ne želi obavijesti od muted_user_id
CREATE TABLE IF NOT EXISTS notification_mutes (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, muted_user_id)
);

-- Push pretplate preglednika (Web Push) — po uređaju, za obavijesti i kad je app zatvorena
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
