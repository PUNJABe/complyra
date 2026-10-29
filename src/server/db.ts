import Database from "better-sqlite3";
import postgres, { type Sql } from "postgres";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

export type Row = Record<string, unknown>;
export type Result = { changes: number };
export type Statement = {
  all(...args: unknown[]): Promise<Row[]>;
  get(...args: unknown[]): Promise<Row | undefined>;
  run(...args: unknown[]): Promise<Result>;
};
export type DatabaseLike = {
  prepare(query: string): Statement;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  exec(query: string): void;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY,name TEXT NOT NULL,gstin TEXT NOT NULL DEFAULT '',pan TEXT NOT NULL DEFAULT '',sector TEXT NOT NULL DEFAULT '',currency TEXT NOT NULL DEFAULT 'INR',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,filename TEXT NOT NULL,file_sha256 TEXT NOT NULL,rows_total INTEGER NOT NULL,rows_imported INTEGER NOT NULL,rows_duplicate INTEGER NOT NULL,rows_rejected INTEGER NOT NULL,errors_json TEXT NOT NULL DEFAULT '[]',created_by TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,row_hash TEXT NOT NULL,txn_date TEXT NOT NULL,merchant TEXT NOT NULL,merchant_norm TEXT NOT NULL,amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),direction TEXT NOT NULL,employee TEXT NOT NULL DEFAULT '',department TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT 'Uncategorised',invoice_no TEXT NOT NULL DEFAULT '',vendor_gstin TEXT NOT NULL DEFAULT '',reference TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,UNIQUE (client_id,row_hash));
CREATE INDEX IF NOT EXISTS idx_txn_client_date ON transactions (client_id,txn_date);
CREATE INDEX IF NOT EXISTS idx_txn_import ON transactions (import_id);
CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,name TEXT NOT NULL,kind TEXT NOT NULL,params_json TEXT NOT NULL,severity TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS findings (id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,fingerprint TEXT NOT NULL,rule_id TEXT,rule_kind TEXT NOT NULL,rule_name TEXT NOT NULL,severity TEXT NOT NULL,title TEXT NOT NULL,why TEXT NOT NULL,evidence TEXT NOT NULL,amount_paise INTEGER NOT NULL,txn_ids_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',reviewed_by TEXT,review_note TEXT,reviewed_at TEXT,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,UNIQUE (client_id,fingerprint));
CREATE INDEX IF NOT EXISTS idx_findings_client_status ON findings (client_id,status);
CREATE TABLE IF NOT EXISTS analysis_runs (client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,ran_at TEXT NOT NULL,txn_count INTEGER NOT NULL,detections INTEGER NOT NULL,skipped_json TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS audit_log (seq INTEGER PRIMARY KEY,ts TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,resource TEXT NOT NULL DEFAULT '',details TEXT NOT NULL,severity TEXT NOT NULL DEFAULT 'info',ip TEXT NOT NULL DEFAULT '',client_id TEXT,prev_hash TEXT NOT NULL,hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY,client_id TEXT,channel TEXT NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 5,next_attempt_at TEXT NOT NULL,last_error TEXT,provider_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deadlines (id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,kind TEXT NOT NULL,label TEXT NOT NULL,due_date TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0,done_at TEXT,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_deadlines_client ON deadlines (client_id,due_date);
CREATE TABLE IF NOT EXISTS import_templates (id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,name TEXT NOT NULL,options_json TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(client_id,name));
CREATE TABLE IF NOT EXISTS finding_tasks (finding_id TEXT PRIMARY KEY REFERENCES findings(id) ON DELETE CASCADE,assignee TEXT,due_date TEXT,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS finding_comments (id TEXT PRIMARY KEY,finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,author TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_finding_comments_finding ON finding_comments(finding_id,created_at);
CREATE TABLE IF NOT EXISTS policy_versions (id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,rule_id TEXT NOT NULL,rule_name TEXT NOT NULL,version INTEGER NOT NULL,change_type TEXT NOT NULL,rule_json TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_policy_versions_rule ON policy_versions(client_id,rule_id,version);
CREATE TABLE IF NOT EXISTS policy_change_requests (id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,rule_id TEXT,action TEXT NOT NULL,rule_json TEXT NOT NULL,requested_by TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',reviewed_by TEXT,review_note TEXT,created_at TEXT NOT NULL,reviewed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_policy_requests_client ON policy_change_requests(client_id,status,created_at);
`;

function positional(query: string, args: unknown[]): { query: string; args: unknown[] } {
  if (args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0])) {
    const values: unknown[] = [];
    const text = query.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_, key: string) => {
      values.push((args[0] as Record<string, unknown>)[key]);
      return `$${values.length}`;
    });
    return { query: text, args: values };
  }
  let i = 0;
  return { query: query.replace(/\?/g, () => `$${++i}`), args };
}

class SqliteAdapter implements DatabaseLike {
  constructor(private readonly db: Database.Database) {}
  exec(query: string): void { this.db.exec(query); }
  prepare(query: string): Statement {
    const stmt = this.db.prepare(query);
    return {
      all: async (...args) => stmt.all(...args) as Row[],
      get: async (...args) => stmt.get(...args) as Row | undefined,
      run: async (...args) => ({ changes: Number(stmt.run(...args).changes) }),
    };
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try { const result = await fn(); this.db.exec("COMMIT"); return result; }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
}

class PostgresAdapter implements DatabaseLike {
  private readonly ready: Promise<unknown>;
  constructor(private readonly sql: Sql) {
    // PostgreSQL does not make INTEGER PRIMARY KEY auto-increment, unlike SQLite.
    // Keep the SQLite schema unchanged and use an identity column in Postgres.
    const schema = SCHEMA.replace(
      "seq INTEGER PRIMARY KEY",
      "seq INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY",
    );
    this.ready = sql.unsafe(schema).then(() => sql.unsafe(`
      CREATE OR REPLACE FUNCTION complyra_audit_immutable() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'append-only audit log'; END;
      $$;
      DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
      CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION complyra_audit_immutable();
      DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
      CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION complyra_audit_immutable();
    `));
  }
  prepare(query: string): Statement {
    const execute = async (args: unknown[]) => {
      const ignore = /INSERT OR IGNORE/i.test(query);
      const p = positional(query.replace(/INSERT OR IGNORE/gi, "INSERT") + (ignore ? " ON CONFLICT DO NOTHING" : ""), args);
      return this.ready.then(() => this.sql.unsafe(p.query, p.args as Parameters<Sql["unsafe"]>[1]));
    };
    return {
      all: async (...args) => (await execute(args)) as unknown as Row[],
      get: async (...args) => ((await execute(args))[0] as Row | undefined),
      run: async (...args) => ({ changes: (await execute(args)).count ?? 0 }),
    };
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.ready;
    // Queries are issued through the shared client. Starting a separate
    // transaction here would reserve the only pooled connection and make
    // nested prepared statements wait forever.
    return fn();
  }
  exec(query: string): void {
    void query;
    throw new Error("exec is only available for the local SQLite adapter");
  }
}

const g = globalThis as unknown as { __complyraDb?: DatabaseLike; __complyraSql?: Sql };

export function openDb(file: string): DatabaseLike {
  if (process.env.DATABASE_URL) {
    const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
    return new PostgresAdapter(sql);
  }
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_log_no_update
      BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'append-only audit log'); END;
    CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
      BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'append-only audit log'); END;
  `);
  return new SqliteAdapter(db);
}

export function getDb(): DatabaseLike {
  if (!g.__complyraDb) {
    const file = process.env.COMPLYRA_DB_PATH || path.join(dataDir(), "complyra.db");
    g.__complyraDb = openDb(file);
  }
  return g.__complyraDb;
}

export function newId(): string { return crypto.randomUUID(); }
export const nowIso = () => new Date().toISOString();
