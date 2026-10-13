'use strict';

// FastWebsiteCreator backend:
//  • receives project briefs (with uploaded files) from the website form,
//    saves them and emails a notification through Resend (https://resend.com)
//  • serves the owner's admin dashboard at /admin
//
//   ADMIN_EMAIL / ADMIN_PASSWORD — owner dashboard login (dashboard is off until both are set)
//   DB_PATH          — SQLite database file (keep on a persistent disk)
//   UPLOAD_DIR       — where uploaded files are stored (keep on a persistent disk)
//   RESEND_API_KEY   — API key from Resend (optional; without it briefs are saved but no email is sent)
//   NOTIFY_EMAIL     — where brief notifications go. Until your domain is verified in Resend,
//                      this must be the email address of your Resend account.
//   MAIL_FROM        — optional sender once fastwebsitecreator.com is verified in Resend
//   ADMIN_URL        — public address of the dashboard, used for links in emails
//   ALLOWED_ORIGINS  — comma-separated sites allowed to post the form
//   PORT             — HTTP port (Render sets this)

const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { openDb, STATUSES } = require('./db');
const { createAuth } = require('./auth');
const { buildClientEmail, hasEmail } = require('./client-emails');

const MAX_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // keeps the email under Resend's 40 MB limit
const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.heic', '.heif',
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.key', '.txt', '.rtf',
  '.ai', '.eps', '.psd', '.fig', '.sketch', '.zip',
]);
// Only these are ever shown inline in the dashboard; everything else downloads.
const INLINE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const FIELDS = [
  ['name', 'Name'],
  ['email', 'Email'],
  ['business', 'Business'],
  ['phone', 'Phone'],
  ['concept', 'Idea'],
  ['pages', 'Pages'],
  ['assetLinks', 'Links to large files'],
  ['inspiration', 'Websites they like'],
  ['have', 'Already has'],
  ['support', '$10/mo support'],
];
const DEFAULT_ORIGINS = 'https://fastwebsitecreator.com,https://www.fastwebsitecreator.com,https://fastwebsitecreator.onrender.com';
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_CSP = "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);

function buildEmail(fields, files, link) {
  const rows = FIELDS.map(([key, label]) => [label, fields[key]]).filter(([, value]) => value);
  const fileNote = files.length ? `${files.length} file(s) attached.` : 'No files uploaded.';
  const text = [
    'New project brief from fastwebsitecreator.com:',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    fileNote,
    link ? `Open it in your dashboard: ${link}` : null,
    'Reply to this email to respond directly to the client.',
  ].filter((line) => line !== null).join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;color:#2b3247;max-width:600px">
      <h2 style="color:#0b1020;margin:0 0 16px">New project brief</h2>
      <table style="border-collapse:collapse;width:100%">
        ${rows.map(([label, value]) => `
          <tr>
            <td style="padding:8px 12px 8px 0;color:#5d6680;font-weight:bold;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>
            <td style="padding:8px 0;white-space:pre-wrap">${escapeHtml(value)}</td>
          </tr>`).join('')}
      </table>
      <p style="margin:20px 0 0;color:#5d6680">${escapeHtml(fileNote)} Reply to this email to respond directly to ${escapeHtml(fields.name)}.</p>
      ${link ? `<p><a href="${escapeHtml(link)}" style="color:#6c5cff">Open it in your dashboard →</a></p>` : ''}
    </div>`;
  return { subject: `New website project: ${fields.business}`, text, html };
}

async function sendWithResend({ apiKey, from, to, replyTo, email, files }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: replyTo,
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachments: (files || []).map((f) => ({ filename: f.originalname, content: f.buffer.toString('base64') })),
    }),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
}

function createApp(env = process.env, { send = sendWithResend, db } = {}) {
  db = db || openDb(env.DB_PATH || path.join(__dirname, 'data', 'fwc.db'));
  const uploadDir = env.UPLOAD_DIR || path.join(__dirname, 'data', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const auth = createAuth(db, env);
  const origins = new Set((env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((o) => o.trim()).filter(Boolean));
  const hits = new Map();

  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES, fields: 30, fieldSize: 20 * 1024 },
    fileFilter: (req, file, cb) => {
      const ok = ALLOWED_EXTENSIONS.has(path.extname(file.originalname).toLowerCase());
      cb(ok ? null : Object.assign(new Error(`"${file.originalname}" isn't a supported file type.`), { status: 400 }), ok);
    },
  });

  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/healthz', (req, res) => res.send('ok'));

  // ───────────── Public: project brief form ─────────────

  app.use('/api/brief', (req, res, next) => {
    const origin = req.get('origin');
    if (origin && origins.has(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Accept');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    if (origin && !origins.has(origin)) return res.status(403).json({ error: 'Forbidden' });
    next();
  });

  // Basic per-IP rate limit: 5 briefs per 10 minutes.
  const briefRateLimit = (req, res, next) => {
    const now = Date.now();
    const recent = (hits.get(req.ip) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (recent.length >= 5) return res.status(429).json({ error: 'Too many submissions. Please try again in a few minutes.' });
    recent.push(now);
    hits.set(req.ip, recent);
    next();
  };

  function saveBrief(fields, files) {
    const support = fields.support ? 1 : 0;
    db.exec('BEGIN');
    try {
      const existing = db.prepare('SELECT id FROM clients WHERE email = ?').get(fields.email);
      let clientId;
      if (existing) {
        clientId = existing.id;
        db.prepare(`UPDATE clients SET name = ?, business = ?, phone = COALESCE(NULLIF(?, ''), phone),
                    support = MAX(support, ?) WHERE id = ?`)
          .run(fields.name, fields.business, fields.phone, support, clientId);
      } else {
        clientId = Number(db.prepare('INSERT INTO clients (email, name, business, phone, support) VALUES (?, ?, ?, ?, ?)')
          .run(fields.email, fields.name, fields.business, fields.phone || null, support).lastInsertRowid);
      }
      const requestId = Number(db.prepare(`INSERT INTO requests (client_id, business, concept, pages, asset_links, inspiration, have, support)
                                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(clientId, fields.business, fields.concept, fields.pages, fields.assetLinks, fields.inspiration, fields.have, support).lastInsertRowid);
      const dir = path.join(uploadDir, String(requestId));
      if (files.length) fs.mkdirSync(dir, { recursive: true });
      for (const file of files) {
        const stored = crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase();
        fs.writeFileSync(path.join(dir, stored), file.buffer);
        db.prepare('INSERT INTO files (request_id, original_name, stored_name, size) VALUES (?, ?, ?, ?)')
          .run(requestId, clean(file.originalname, 255), stored, file.size);
      }
      db.exec('COMMIT');
      return requestId;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  app.post('/api/brief', briefRateLimit, upload.array('files', MAX_FILES), async (req, res) => {
    const body = req.body || {};
    if (body._gotcha) return res.json({ ok: true }); // bot trap

    const fields = {};
    for (const [key] of FIELDS) {
      const value = body[key];
      fields[key] = clean(Array.isArray(value) ? value.join(', ') : value);
    }
    fields.email = fields.email.toLowerCase();
    if (!fields.name || !fields.business || !fields.concept || !isEmail(fields.email)) {
      return res.status(400).json({ error: 'Please fill in your name, a valid email, business name and idea.' });
    }
    const files = req.files || [];
    if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) {
      return res.status(400).json({ error: 'Files are over 25 MB in total. Please upload fewer files, or paste a link for large ones.' });
    }

    const requestId = saveBrief(fields, files);
    res.json({ ok: true });

    if (env.RESEND_API_KEY && env.NOTIFY_EMAIL) {
      const link = env.ADMIN_URL ? `${env.ADMIN_URL.replace(/\/$/, '')}/admin#/requests/${requestId}` : null;
      send({
        apiKey: env.RESEND_API_KEY,
        from: env.MAIL_FROM || 'FastWebsiteCreator <onboarding@resend.dev>',
        to: env.NOTIFY_EMAIL,
        replyTo: fields.email,
        email: buildEmail(fields, files, link),
        files,
      }).catch((err) => console.error(`Brief #${requestId} saved, but the email failed:`, err.message));
    }
  });

  // ───────────── Owner dashboard ─────────────

  const adminPage = (file) => (req, res) => {
    res.set('Content-Security-Policy', ADMIN_CSP);
    res.set('X-Frame-Options', 'DENY');
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(PUBLIC_DIR, file));
  };
  app.get('/', (req, res) => res.redirect('/admin'));
  app.get('/admin', (req, res, next) => adminPage(auth.isAdmin(req) ? 'admin.html' : 'login.html')(req, res, next));
  app.use('/admin/assets', express.static(path.join(PUBLIC_DIR, 'assets'), { maxAge: '1h' }));

  const json = express.json({ limit: '100kb' });
  // Writes must be JSON: together with the SameSite=Strict cookie this blocks cross-site form posts.
  const requireJson = (req, res, next) => (req.is('application/json') ? next() : res.status(415).json({ error: 'Expected JSON.' }));

  app.post('/api/admin/login', requireJson, json, (req, res) => {
    if (!auth.enabled()) return res.status(503).json({ error: 'Set ADMIN_EMAIL and ADMIN_PASSWORD in Render to turn on the dashboard.' });
    if (auth.rateLimited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const { email, password } = req.body || {};
    if (!auth.checkCredentials(email, password)) return res.status(401).json({ error: 'Incorrect email or password.' });
    auth.clearAttempts(req.ip);
    auth.startSession(res);
    res.json({ ok: true });
  });

  app.post('/api/admin/logout', (req, res) => {
    auth.endSession(req, res);
    res.json({ ok: true });
  });

  const admin = express.Router();
  admin.use(auth.requireAdmin);
  admin.use((req, res, next) => (req.method === 'PATCH' || req.method === 'POST' ? requireJson(req, res, next) : next()));
  admin.use(json);
  admin.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  const likeQuery = (q) => `%${String(q || '').trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  admin.get('/summary', (req, res) => {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM requests GROUP BY status').all()) counts[row.status] = row.n;
    const clients = db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
    const support = db.prepare('SELECT COUNT(*) AS n FROM clients WHERE support = 1').get().n;
    res.json({ counts, clients, support, statuses: STATUSES });
  });

  admin.get('/requests', (req, res) => {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const rows = db.prepare(`
      SELECT r.id, r.business, r.status, r.support, r.created_at, r.updated_at,
             c.id AS client_id, c.name AS client_name, c.email AS client_email,
             (SELECT COUNT(*) FROM files f WHERE f.request_id = r.id) AS file_count
      FROM requests r JOIN clients c ON c.id = r.client_id
      WHERE (? IS NULL OR r.status = ?)
        AND (r.business LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\' OR r.concept LIKE ? ESCAPE '\\')
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 500
    `).all(status, status, ...Array(4).fill(likeQuery(req.query.q)));
    res.json({ requests: rows });
  });

  const getRequest = (id) => db.prepare('SELECT * FROM requests WHERE id = ?').get(id);

  admin.get('/requests/:id', (req, res) => {
    const request = getRequest(req.params.id);
    if (!request) return res.status(404).json({ error: 'Not found' });
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(request.client_id);
    const files = db.prepare('SELECT id, original_name, size, created_at FROM files WHERE request_id = ? ORDER BY id').all(request.id)
      .map((f) => ({ ...f, previewable: Boolean(INLINE_TYPES[path.extname(f.original_name).toLowerCase()]) }));
    const otherRequests = db.prepare('SELECT id, business, status, created_at FROM requests WHERE client_id = ? AND id != ? ORDER BY created_at DESC')
      .all(request.client_id, request.id);
    const emails = db.prepare('SELECT id, status, to_email, subject, body, error, sent_at FROM client_emails WHERE request_id = ? ORDER BY id DESC')
      .all(request.id);
    res.json({ request, client, files, otherRequests, emails });
  });

  const getClient = (id) => db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  const mailFrom = () => env.MAIL_FROM || 'FastWebsiteCreator <onboarding@resend.dev>';

  // Preview of the email the client would get for a status change.
  admin.get('/requests/:id/client-email', (req, res) => {
    const request = getRequest(req.params.id);
    if (!request) return res.status(404).json({ error: 'Not found' });
    const client = getClient(request.client_id);
    const email = buildClientEmail(req.query.status, request, client, clean(req.query.message, 5000));
    res.json({ to: client.email, email: email && { subject: email.subject, text: email.text } });
  });

  async function emailClient(request, status, message) {
    const client = getClient(request.client_id);
    const email = buildClientEmail(status, request, client, message);
    let error = null;
    if (!env.RESEND_API_KEY) {
      error = 'Email is not set up (RESEND_API_KEY is missing).';
    } else {
      try {
        await send({ apiKey: env.RESEND_API_KEY, from: mailFrom(), to: client.email, replyTo: env.NOTIFY_EMAIL || undefined, email });
      } catch (err) {
        console.error(`Status email for request #${request.id} failed:`, err.message);
        error = 'The email service refused the message. Check Resend → Logs.';
      }
    }
    db.prepare('INSERT INTO client_emails (request_id, status, to_email, subject, body, error) VALUES (?, ?, ?, ?, ?, ?)')
      .run(request.id, status, client.email, email.subject, email.text, error);
    return error ? { sent: false, error } : { sent: true, to: client.email };
  }

  admin.patch('/requests/:id', async (req, res) => {
    const request = getRequest(req.params.id);
    if (!request) return res.status(404).json({ error: 'Not found' });
    const { status, notes, notifyClient, message } = req.body || {};
    if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status.' });
    db.prepare("UPDATE requests SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status ?? request.status, notes !== undefined ? clean(notes, 20000) : request.notes, request.id);
    const updated = getRequest(request.id);
    const changed = status !== undefined && status !== request.status;
    const clientEmail = changed && notifyClient && hasEmail(status)
      ? await emailClient(updated, status, clean(message, 5000))
      : null;
    res.json({ request: updated, clientEmail });
  });

  admin.delete('/requests/:id', (req, res) => {
    const request = getRequest(req.params.id);
    if (!request) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM requests WHERE id = ?').run(request.id);
    fs.rmSync(path.join(uploadDir, String(request.id)), { recursive: true, force: true });
    res.json({ ok: true });
  });

  admin.get('/clients', (req, res) => {
    const rows = db.prepare(`
      SELECT c.id, c.name, c.email, c.business, c.phone, c.support, c.created_at,
             COUNT(r.id) AS request_count,
             MAX(r.created_at) AS last_request_at,
             (SELECT r2.status FROM requests r2 WHERE r2.client_id = c.id ORDER BY r2.created_at DESC, r2.id DESC LIMIT 1) AS latest_status
      FROM clients c LEFT JOIN requests r ON r.client_id = c.id
      WHERE c.name LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\' OR c.business LIKE ? ESCAPE '\\'
      GROUP BY c.id
      ORDER BY COALESCE(MAX(r.created_at), c.created_at) DESC
      LIMIT 500
    `).all(...Array(3).fill(likeQuery(req.query.q)));
    res.json({ clients: rows });
  });

  admin.get('/clients/:id', (req, res) => {
    const client = getClient(req.params.id);
    if (!client) return res.status(404).json({ error: 'Not found' });
    const requests = db.prepare(`
      SELECT r.id, r.business, r.status, r.created_at, r.updated_at,
             (SELECT COUNT(*) FROM files f WHERE f.request_id = r.id) AS file_count
      FROM requests r WHERE r.client_id = ? ORDER BY r.created_at DESC, r.id DESC
    `).all(client.id);
    res.json({ client, requests });
  });

  admin.patch('/clients/:id', (req, res) => {
    const client = getClient(req.params.id);
    if (!client) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const next = {
      name: b.name !== undefined ? clean(b.name, 200) : client.name,
      business: b.business !== undefined ? clean(b.business, 200) : client.business,
      phone: b.phone !== undefined ? clean(b.phone, 50) : client.phone,
      support: b.support !== undefined ? (b.support ? 1 : 0) : client.support,
      notes: b.notes !== undefined ? clean(b.notes, 20000) : client.notes,
    };
    if (!next.name) return res.status(400).json({ error: 'Name is required.' });
    db.prepare('UPDATE clients SET name = ?, business = ?, phone = ?, support = ?, notes = ? WHERE id = ?')
      .run(next.name, next.business, next.phone, next.support, next.notes, client.id);
    res.json({ client: getClient(client.id) });
  });

  app.use('/api/admin', admin);

  // Uploaded files: owner only. Safe image types can be previewed; everything else is a download.
  app.get('/admin/files/:id', (req, res) => {
    if (!auth.isAdmin(req)) return res.status(401).send('Please sign in.');
    const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
    if (!file) return res.status(404).send('Not found');
    const filePath = path.join(uploadDir, String(file.request_id), path.basename(file.stored_name));
    if (!fs.existsSync(filePath)) return res.status(404).send('File missing');
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    res.set('Cache-Control', 'private, no-store');
    const inlineType = INLINE_TYPES[path.extname(file.stored_name)];
    if (req.query.inline === '1' && inlineType) {
      res.type(inlineType);
      return res.sendFile(filePath);
    }
    res.download(filePath, file.original_name);
  });

  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: 'Each file must be 10 MB or smaller.',
        LIMIT_FILE_COUNT: `Please upload at most ${MAX_FILES} files.`,
      };
      return res.status(400).json({ error: messages[err.code] || 'There was a problem with your upload.' });
    }
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3001;
  createApp().listen(port, () => console.log(`FastWebsiteCreator backend listening on :${port}`));
}

module.exports = { createApp, buildEmail };
