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
  auto_reminder BOOLEAN NOT NULL DEFAULT FALSE, -- true = automatski podsjetnik iz bauštele
  last_reminded TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
