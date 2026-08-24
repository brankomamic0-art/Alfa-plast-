import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { migrate, q, one } from './db.js';
import { notify, userIds } from './notify.js';
import usersRouter from './routes/users.js';
import tasksRouter from './routes/tasks.js';
import jobsRouter from './routes/jobs.js';
import notificationsRouter from './routes/notifications.js';
import pushRouter from './routes/push.js';
import vehiclesRouter from './routes/vehicles.js';
import paintingRouter from './routes/painting.js';
import ordersRouter from './routes/orders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// API
app.use('/api', usersRouter);
app.use('/api', tasksRouter);
app.use('/api', jobsRouter);
app.use('/api', notificationsRouter);
app.use('/api', pushRouter);
app.use('/api', vehiclesRouter);
app.use('/api', paintingRouter);
app.use('/api', ordersRouter);

// Fotografije
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));

// Frontend build (React)
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// Globalni error handler (npr. multer)
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Došlo je do pogreške.' });
});

// =====================================================
// SCHEDULER
// 1) Podsjetnik za zadatke u statusu "primljeno" — svaka REMINDER_HOURS (zadano 24h)
// 2) Bauštele s planiranim datumom: JOB_REMINDER_DAYS (zadano 3) prije montaže
//    automatski se kreira zadatak-podsjetnik u to-do listi kreatora
// =====================================================
const REMINDER_HOURS = Number(process.env.REMINDER_HOURS || 24);
const JOB_REMINDER_DAYS = Number(process.env.JOB_REMINDER_DAYS || 3);

// Podsjetnik ide svakom izvršitelju posebno — zadatak može imati više ljudi.
async function taskReminders() {
  const rows = await q(
    `SELECT a.task_id, a.user_id, t.title FROM task_assignees a
     JOIN tasks t ON t.id = a.task_id
     WHERE a.status = 'primljeno'
       AND COALESCE(a.last_reminded, a.updated_at) < now() - ($1 || ' hours')::interval`,
    [REMINDER_HOURS]
  );
  for (const r of rows) {
    await notify({
      recipients: [r.user_id],
      actorId: null,
      type: 'podsjetnik',
      title: 'Podsjetnik na zadatak',
      body: `Zadatak "${r.title}" još nije završen.`,
      refType: 'task',
      refId: r.task_id,
    });
    await q('UPDATE task_assignees SET last_reminded = now() WHERE task_id = $1 AND user_id = $2', [r.task_id, r.user_id]);
  }
}

async function jobReminders() {
  const jobs = await q(
    `SELECT * FROM jobs
     WHERE reminder_sent = FALSE AND archived = FALSE AND status <> 'zavrseno'
       AND planned_date IS NOT NULL
       AND planned_date <= (CURRENT_DATE + ($1 || ' days')::interval)::date`,
    [JOB_REMINDER_DAYS]
  );
  for (const j of jobs) {
    const reminder = await one(
      `INSERT INTO tasks (title, description, assigned_to, created_by, status, due_date, job_id, auto_reminder)
       VALUES ($1,$2,$3,$3,'poslano',$4,$5,TRUE) RETURNING id`,
      [
        `Podsjetnik: bauštela "${j.name}"`,
        `Planirana montaža: ${new Date(j.planned_date).toLocaleDateString('hr-HR')}. Provjerite jesu li svi materijali spremni.`,
        j.created_by,
        j.planned_date,
        j.id,
      ]
    );
    await q('INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [reminder.id, j.created_by]);
    await q('UPDATE jobs SET reminder_sent = TRUE WHERE id = $1', [j.id]);
    await notify({
      recipients: await userIds(['admin']),
      actorId: null,
      type: 'podsjetnik',
      title: `Bliži se montaža: "${j.name}"`,
      body: `Planirani datum: ${new Date(j.planned_date).toLocaleDateString('hr-HR')}`,
      refType: 'job',
      refId: j.id,
    });
  }
}

async function scheduler() {
  try {
    await taskReminders();
    await jobReminders();
  } catch (e) {
    console.error('Scheduler greška:', e.message);
  }
}

// =====================================================
const PORT = process.env.PORT || 3000;
migrate()
  .then(() => {
    setInterval(scheduler, 15 * 60 * 1000); // svakih 15 min
    scheduler();
    app.listen(PORT, () => console.log(`✔ Alfa Plast server na portu ${PORT}`));
  })
  .catch((e) => {
    console.error('Neuspješno spajanje na bazu:', e.message);
    process.exit(1);
  });
