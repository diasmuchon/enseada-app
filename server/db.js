'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'enseada.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone         TEXT,
  apartment     TEXT,
  role          TEXT NOT NULL CHECK (role IN ('admin','operador','porteiro','manobrista','morador')),
  status        TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','pendente','inativo')),
  email_notify  INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  keys_json  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  url        TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS packages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  apartment      TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('correspondencia','pacote')),
  description    TEXT,
  sender         TEXT,
  recipient_name TEXT,
  status         TEXT NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando','retirado')),
  received_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  received_at    TEXT NOT NULL DEFAULT (datetime('now')),
  picked_up_by   TEXT,
  delivered_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  picked_up_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_packages_apt ON packages(apartment, status);

CREATE TABLE IF NOT EXISTS vehicles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  apartment   TEXT NOT NULL,
  plate       TEXT NOT NULL,
  model       TEXT,
  color       TEXT,
  spot        TEXT,
  status      TEXT NOT NULL DEFAULT 'estacionado' CHECK (status IN ('estacionado','saiu')),
  entered_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entered_at  TEXT NOT NULL DEFAULT (datetime('now')),
  exited_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  exited_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_vehicles_apt ON vehicles(apartment, status);

CREATE TABLE IF NOT EXISTS flood_alerts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  message         TEXT,
  activated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  activated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deactivated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deactivated_at  TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

/** Runs fn inside a transaction. */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, getSetting, setSetting, tx };
