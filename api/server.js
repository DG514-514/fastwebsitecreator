'use strict';

// Receives project briefs (with uploaded files) from the website form and
// emails them to the business through Resend (https://resend.com).
//
//   RESEND_API_KEY   — API key from Resend (required to send)
//   NOTIFY_EMAIL     — where briefs go. Until your domain is verified in Resend,
//                      this must be the email address of your Resend account.
//   MAIL_FROM        — optional sender once fastwebsitecreator.com is verified in Resend,
//                      e.g. "FastWebsiteCreator <briefs@fastwebsitecreator.com>"
//   ALLOWED_ORIGINS  — comma-separated sites allowed to post the form
//   PORT             — HTTP port (Render sets this)

const express = require('express');
const multer = require('multer');
const path = require('node:path');

const MAX_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // keeps the email under Resend's 40 MB limit
const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.heic', '.heif',
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.key', '.txt', '.rtf',
  '.ai', '.eps', '.psd', '.fig', '.sketch', '.zip',
]);
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

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function buildEmail(fields, files) {
  const rows = FIELDS.map(([key, label]) => [label, fields[key]]).filter(([, value]) => value);
  const fileNote = files.length ? `${files.length} file(s) attached.` : 'No files uploaded.';
  const text = [
    'New project brief from fastwebsitecreator.com:',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    fileNote,
    'Reply to this email to respond directly to the client.',
  ].join('\n');
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
      attachments: files.map((f) => ({ filename: f.originalname, content: f.buffer.toString('base64') })),
    }),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
}

function createApp(env = process.env, send = sendWithResend) {
  const app = express();
  const origins = new Set((env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((o) => o.trim()).filter(Boolean));
  const hits = new Map();

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
    const origin = req.get('origin');
    if (origin && origins.has(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Accept');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/healthz', (req, res) => res.send('ok'));

  // Basic per-IP rate limit: 5 briefs per 10 minutes.
  const rateLimit = (req, res, next) => {
    const now = Date.now();
    const recent = (hits.get(req.ip) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (recent.length >= 5) return res.status(429).json({ error: 'Too many submissions. Please try again in a few minutes.' });
    recent.push(now);
    hits.set(req.ip, recent);
    next();
  };

  app.post('/api/brief', (req, res, next) => {
    const origin = req.get('origin');
    if (origin && !origins.has(origin)) return res.status(403).json({ error: 'Forbidden' });
    next();
  }, rateLimit, upload.array('files', MAX_FILES), async (req, res) => {
    const body = req.body || {};
    if (body._gotcha) return res.json({ ok: true }); // bot trap

    const fields = {};
    for (const [key] of FIELDS) {
      const value = body[key];
      fields[key] = (Array.isArray(value) ? value.join(', ') : String(value ?? '')).trim().slice(0, 5000);
    }
    if (!fields.name || !fields.business || !fields.concept || !isEmail(fields.email)) {
      return res.status(400).json({ error: 'Please fill in your name, a valid email, business name and idea.' });
    }
    const files = req.files || [];
    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      return res.status(400).json({ error: 'Files are over 25 MB in total. Please upload fewer files, or paste a link for large ones.' });
    }
    if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) {
      console.error('Brief received but RESEND_API_KEY / NOTIFY_EMAIL are not set');
      return res.status(503).json({ error: 'Our form is temporarily unavailable.' });
    }

    try {
      await send({
        apiKey: env.RESEND_API_KEY,
        from: env.MAIL_FROM || 'FastWebsiteCreator <onboarding@resend.dev>',
        to: env.NOTIFY_EMAIL,
        replyTo: fields.email,
        email: buildEmail(fields, files),
        files,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('Failed to send brief:', err.message);
      res.status(502).json({ error: 'We couldn’t send your brief.' });
    }
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
  createApp().listen(port, () => console.log(`Brief API listening on :${port}`));
}

module.exports = { createApp, buildEmail };
