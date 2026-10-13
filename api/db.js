'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const STATUSES = ['new', 'reviewing', 'awaiting_payment', 'building', 'draft_sent', 'live', 'closed'];

function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS clients (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name       TEXT NOT NULL,
      business   TEXT,
      phone      TEXT,
      support    INTEGER NOT NULL DEFAULT 0,
      notes      TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS requests (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      business    TEXT NOT NULL,
      concept     TEXT NOT NULL,
      pages       TEXT,
      asset_links TEXT,
      inspiration TEXT,
      have        TEXT,
      support     INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'reviewing', 'awaiting_payment', 'building', 'draft_sent', 'live', 'closed')),
      notes       TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_requests_client ON requests(client_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status, created_at);

    CREATE TABLE IF NOT EXISTS files (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id    INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name   TEXT NOT NULL,
      size          INTEGER NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_files_request ON files(request_id);

    CREATE TABLE IF NOT EXISTS client_emails (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      status     TEXT NOT NULL,
      to_email   TEXT NOT NULL,
      subject    TEXT NOT NULL,
      body       TEXT NOT NULL,
      error      TEXT,
      sent_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_client_emails_request ON client_emails(request_id, sent_at);

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
  `);
  return db;
}

module.exports = { openDb, STATUSES };
