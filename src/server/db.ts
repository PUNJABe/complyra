import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

const g = globalThis as unknown as { __complyraDb?: Database.Database };

const MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','reviewer','viewer')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gstin TEXT NOT NULL DEFAULT '',
    pan TEXT NOT NULL DEFAULT '',
    sector TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'INR',
    created_at TEXT NOT NULL
  );

  CREATE TABLE imports (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_sha256 TEXT NOT NULL,
    rows_total INTEGER NOT NULL,
    rows_imported INTEGER NOT NULL,
    rows_duplicate INTEGER NOT NULL,
    rows_rejected INTEGER NOT NULL,
    errors_json TEXT NOT NULL DEFAULT '[]',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    row_hash TEXT NOT NULL,
    txn_date TEXT NOT NULL,
    merchant TEXT NOT NULL,
    merchant_norm TEXT NOT NULL,
    amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
    direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
    employee TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Uncategorised',
    invoice_no TEXT NOT NULL DEFAULT '',
    vendor_gstin TEXT NOT NULL DEFAULT '',
    reference TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (client_id, row_hash)
  );
  CREATE INDEX idx_txn_client_date ON transactions (client_id, txn_date);
  CREATE INDEX idx_txn_import ON transactions (import_id);

  CREATE TABLE rules (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    params_json TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE findings (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    rule_id TEXT,
    rule_kind TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
    title TEXT NOT NULL,
    why TEXT NOT NULL,
    evidence TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    txn_ids_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','dismissed','escalated')),
    reviewed_by TEXT,
    review_note TEXT,
    reviewed_at TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    UNIQUE (client_id, fingerprint)
  );
  CREATE INDEX idx_findings_client_status ON findings (client_id, status);

  CREATE TABLE analysis_runs (
    client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
    ran_at TEXT NOT NULL,
    txn_count INTEGER NOT NULL,
    detections INTEGER NOT NULL,
    skipped_json TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE audit_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    ip TEXT NOT NULL DEFAULT '',
    client_id TEXT,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
  CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

  CREATE TABLE outbox (
    id TEXT PRIMARY KEY,
    client_id TEXT,
    channel TEXT NOT NULL CHECK (channel IN ('slack','whatsapp')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','retrying','sent','dead')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    next_attempt_at TEXT NOT NULL,
    last_error TEXT,
    provider_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE deadlines (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('GST','TDS','ITR','OTHER')),
    label TEXT NOT NULL,
    due_date TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    done_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_deadlines_client ON deadlines (client_id, due_date);
  `,
];

export function openDb(file: string): Database.Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: Database.Database) {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export function getDb(): Database.Database {
  if (!g.__complyraDb) {
    const file = process.env.COMPLYRA_DB_PATH || path.join(dataDir(), "complyra.db");
    g.__complyraDb = openDb(file);
  }
  return g.__complyraDb;
}

export function newId(): string {
  return crypto.randomUUID();
}

export const nowIso = () => new Date().toISOString();
