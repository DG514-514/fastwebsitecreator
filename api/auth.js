'use strict';

const crypto = require('node:crypto');

const COOKIE_NAME = 'fwc_admin';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest();

// Constant-time comparison of two strings of any length.
const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function createAuth(db, env) {
  const attempts = new Map();
  const secure = env.NODE_ENV === 'production';

  const enabled = () => Boolean(env.ADMIN_EMAIL && env.ADMIN_PASSWORD);

  function checkCredentials(email, password) {
    if (!enabled()) return false;
    const emailOk = safeEqual(String(email || '').trim().toLowerCase(), env.ADMIN_EMAIL.trim().toLowerCase());
    const passwordOk = safeEqual(String(password || ''), env.ADMIN_PASSWORD);
    return emailOk && passwordOk;
  }

  function rateLimited(key) {
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.resetAt < now) {
      attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
      return false;
    }
    entry.count += 1;
    return entry.count > 10;
  }

  function startSession(res) {
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Date.now());
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)')
      .run(sha256(token).toString('hex'), Date.now() + SESSION_TTL_MS);
    res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'strict', secure, maxAge: SESSION_TTL_MS, path: '/' });
  }

  function endSession(req, res) {
    const token = readCookie(req, COOKIE_NAME);
    if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(token).toString('hex'));
    res.clearCookie(COOKIE_NAME, { path: '/' });
  }

  function isAdmin(req) {
    if (!enabled()) return false;
    const token = readCookie(req, COOKIE_NAME);
    if (!token) return false;
    const row = db.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash = ?').get(sha256(token).toString('hex'));
    return Boolean(row && row.expires_at > Date.now());
  }

  function requireAdmin(req, res, next) {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Please sign in.' });
    next();
  }

  return { enabled, checkCredentials, rateLimited, clearAttempts: (key) => attempts.delete(key), startSession, endSession, isAdmin, requireAdmin };
}

module.exports = { createAuth };
