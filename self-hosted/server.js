/**
 * EventHive Tool — Self-Hosted Backend
 * Lightweight Express server that implements the EventHive tool data API,
 * so the tool.html works identically to the EventHive-hosted version.
 *
 * API surface:
 *   GET/POST   /api/data/:resource
 *   GET/PUT/PATCH/DELETE /api/data/:resource/:id
 *   GET        /api/stats
 *   POST       /api/login  { password }
 *   POST       /api/logout
 *   GET        /           → serves tool.html with EVENTHIVE_CONFIG injected
 */
import express from 'express';
import session from 'express-session';
import pg from 'pg';
import bcrypt from 'bcrypt';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');          // parent dir has tool.html
const app = express();
const PORT = process.env.PORT || 3000;

// ── Database ────────────────────────────────────────────────────────────────
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function initDB() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS tool_data (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      resource   TEXT NOT NULL,
      data       JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS tool_data_resource_idx ON tool_data(resource);
  `);
  console.log('Database ready');
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 86_400_000 * 7 }
}));

function requireAuth(req, res, next) {
  if (req.session.authed) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const hash = process.env.PASSWORD_HASH;
  if (!hash) {
    // No password set — open access (useful for local dev)
    req.session.authed = true;
    return res.json({ ok: true });
  }
  const ok = await bcrypt.compare(String(req.body.password || ''), hash);
  if (ok) { req.session.authed = true; return res.json({ ok: true }); }
  res.status(401).json({ error: 'Incorrect password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ authed: !!req.session.authed });
});

// ── Data API ──────────────────────────────────────────────────────────────────
const mapRow = (r) => ({ id: r.id, ...r.data, _createdAt: r.created_at, _updatedAt: r.updated_at });

// List
app.get('/api/data/:resource', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM tool_data WHERE resource=$1 ORDER BY created_at',
    [req.params.resource]
  );
  res.json(rows.map(mapRow));
});

// Create
app.post('/api/data/:resource', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'INSERT INTO tool_data (resource, data) VALUES ($1,$2) RETURNING *',
    [req.params.resource, req.body]
  );
  res.status(201).json(mapRow(rows[0]));
});

// Get one
app.get('/api/data/:resource/:id', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM tool_data WHERE resource=$1 AND id=$2',
    [req.params.resource, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(mapRow(rows[0]));
});

// Replace
app.put('/api/data/:resource/:id', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE tool_data SET data=$1, updated_at=now() WHERE resource=$2 AND id=$3 RETURNING *',
    [req.body, req.params.resource, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(mapRow(rows[0]));
});

// Merge-update
app.patch('/api/data/:resource/:id', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE tool_data SET data=data||$1::jsonb, updated_at=now() WHERE resource=$2 AND id=$3 RETURNING *',
    [JSON.stringify(req.body), req.params.resource, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(mapRow(rows[0]));
});

// Delete
app.delete('/api/data/:resource/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM tool_data WHERE resource=$1 AND id=$2', [req.params.resource, req.params.id]);
  res.json({ ok: true });
});

// Stats
app.get('/api/stats', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT resource, COUNT(*) AS count FROM tool_data GROUP BY resource'
  );
  res.json(Object.fromEntries(rows.map(r => [r.resource, Number(r.count)])));
});

// ── Serve tool.html with EVENTHIVE_CONFIG injected ───────────────────────────
app.get('/', (req, res) => {
  try {
    let html = readFileSync(join(ROOT, 'tool.html'), 'utf8');
    const config = JSON.stringify({
      __hosted: true,
      __apiBase: '/api/data',
      title: process.env.TOOL_TITLE || 'EventHive Tool',
      primaryColor: process.env.PRIMARY_COLOR || '#6366f1',
      accentColor: process.env.ACCENT_COLOR || '#f59e0b'
    });
    // Replace the placeholder config object that the tool ships with
    html = html.replace(
      /window\.EVENTHIVE_CONFIG\s*=\s*\{[^}]*\}/,
      `window.EVENTHIVE_CONFIG = ${config}`
    );
    res.type('html').send(html);
  } catch (err) {
    res.status(500).send('Error loading tool.html: ' + err.message);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`EventHive tool backend running at http://localhost:${PORT}`);
    if (!process.env.PASSWORD_HASH) {
      console.warn('⚠  No PASSWORD_HASH set — running in open-access mode. Set one for production.');
    }
  });
}).catch(err => { console.error('DB init failed', err); process.exit(1); });
