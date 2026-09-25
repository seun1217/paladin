import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  product_id          TEXT PRIMARY KEY,
  coupang_category_id INTEGER NOT NULL,
  category_id         TEXT NOT NULL,
  subcategory_id      TEXT NOT NULL,
  name                TEXT NOT NULL,
  url                 TEXT NOT NULL,
  image_url           TEXT,
  is_rocket           INTEGER NOT NULL DEFAULT 0,
  first_seen_at       INTEGER NOT NULL,
  last_seen_at        INTEGER NOT NULL,
  last_price          INTEGER NOT NULL,
  last_rank           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_subcat    ON products(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_products_last_seen ON products(last_seen_at);

CREATE TABLE IF NOT EXISTS observations (
  product_id TEXT    NOT NULL,
  t          INTEGER NOT NULL,
  price      INTEGER NOT NULL,
  rank       INTEGER NOT NULL,
  PRIMARY KEY (product_id, t)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS alert_state (
  product_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id     TEXT    NOT NULL,
  category_id    TEXT    NOT NULL,
  subcategory_id TEXT    NOT NULL,
  detected_at    INTEGER NOT NULL,
  price          INTEGER NOT NULL,
  baseline_price INTEGER NOT NULL,
  discount_pct   REAL    NOT NULL,
  severity       REAL    NOT NULL,
  reason         TEXT    NOT NULL,
  rank           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deals_detected ON deals(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_subcat   ON deals(subcategory_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_product  ON deals(product_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS users (
  user_id     TEXT PRIMARY KEY,
  sensitivity TEXT    NOT NULL DEFAULT 'normal',
  daily_cap   INTEGER NOT NULL DEFAULT 10,
  quiet_start INTEGER,
  quiet_end   INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_subcategories (
  user_id        TEXT NOT NULL,
  subcategory_id TEXT NOT NULL,
  PRIMARY KEY (user_id, subcategory_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_user_subcat_subcat ON user_subcategories(subcategory_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS telegram_links (
  user_id    TEXT PRIMARY KEY,
  chat_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_link_codes (
  code       TEXT PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL,
  deal_id    INTEGER NOT NULL,
  product_id TEXT    NOT NULL,
  channel    TEXT    NOT NULL,
  sent_at    INTEGER NOT NULL,
  ok         INTEGER NOT NULL,
  error      TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_user_time ON notifications(user_id, sent_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_user_deal_channel ON notifications(user_id, deal_id, channel);

CREATE TABLE IF NOT EXISTS deferred_notifications (
  user_id    TEXT    NOT NULL,
  deal_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, deal_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS poll_runs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  coupang_category_id INTEGER NOT NULL,
  started_at          INTEGER NOT NULL,
  finished_at         INTEGER,
  ok                  INTEGER,
  product_count       INTEGER,
  deal_count          INTEGER,
  error               TEXT
);
CREATE INDEX IF NOT EXISTS idx_poll_runs_cat ON poll_runs(coupang_category_id, started_at DESC);
`;

/**
 * Open (and create/migrate) the SQLite database.
 * Pass ':memory:' for tests.
 */
export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(SCHEMA_SQL);
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;
  const current = row ? Number(row.value) : 0;
  if (current < SCHEMA_VERSION) {
    // future incremental migrations go here, keyed on `current`
    db.prepare(`INSERT INTO meta(key, value) VALUES('schema_version', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(SCHEMA_VERSION));
  }
}

/** Run fn inside a transaction (BEGIN IMMEDIATE ... COMMIT / ROLLBACK). */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}
