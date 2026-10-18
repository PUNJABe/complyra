import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb, nowIso } from "./db";

/**
 * Append-only, hash-chained audit log.
 *  - SQLite triggers reject UPDATE and DELETE on audit_log.
 *  - Each row's hash covers the previous row's hash, so editing or removing a
 *    row in the middle of history breaks the chain and verifyAudit() reports where.
 * Limit: someone with write access to the database *file* could truncate the tail
 * or rebuild the whole chain. Record the head hash somewhere outside this server
 * (the verify endpoint and exports show it) to detect that.
 */

export type AuditEntry = {
  actor: string;
  action: string;
  resource?: string;
  details: string;
  severity?: "info" | "warning" | "critical";
  ip?: string;
  clientId?: string | null;
};

const GENESIS = "GENESIS";

type Hashable = {
  ts: string; actor: string; action: string; resource: string;
  details: string; severity: string; ip: string; client_id: string | null;
};

export function hashEntry(prevHash: string, e: Hashable): string {
  return createHash("sha256")
    .update(prevHash)
    .update("\n")
    .update(JSON.stringify([e.ts, e.actor, e.action, e.resource, e.details, e.severity, e.ip, e.client_id]))
    .digest("hex");
}

export function audit(entry: AuditEntry, db: Database.Database = getDb()): void {
  db.transaction(() => {
    const prev = db.prepare("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined;
    const prevHash = prev?.hash ?? GENESIS;
    const row: Hashable = {
      ts: nowIso(),
      actor: entry.actor,
      action: entry.action,
      resource: entry.resource ?? "",
      details: entry.details.slice(0, 2000),
      severity: entry.severity ?? "info",
      ip: entry.ip ?? "",
      client_id: entry.clientId ?? null,
    };
    const hash = hashEntry(prevHash, row);
    db.prepare(
      `INSERT INTO audit_log (ts, actor, action, resource, details, severity, ip, client_id, prev_hash, hash)
       VALUES (@ts, @actor, @action, @resource, @details, @severity, @ip, @client_id, @prev_hash, @hash)`,
    ).run({ ...row, prev_hash: prevHash, hash });
  })();
}

export type AuditRow = Hashable & { seq: number; prev_hash: string; hash: string };

export function listAudit(
  opts: { limit?: number; beforeSeq?: number; clientId?: string | null; action?: string } = {},
  db: Database.Database = getDb(),
): AuditRow[] {
  const where: string[] = [];
  const args: Record<string, unknown> = {};
  if (opts.beforeSeq) { where.push("seq < @beforeSeq"); args.beforeSeq = opts.beforeSeq; }
  if (opts.clientId) { where.push("(client_id = @clientId OR client_id IS NULL)"); args.clientId = opts.clientId; }
  if (opts.action) { where.push("action = @action"); args.action = opts.action; }
  args.limit = Math.min(opts.limit ?? 50, 500);
  return db
    .prepare(`SELECT * FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY seq DESC LIMIT @limit`)
    .all(args) as AuditRow[];
}

export type VerifyResult =
  | { ok: true; entries: number; head: string }
  | { ok: false; entries: number; brokenAtSeq: number; reason: string };

export function verifyAudit(db: Database.Database = getDb()): VerifyResult {
  let prev = GENESIS;
  let count = 0;
  const rows = db.prepare("SELECT * FROM audit_log ORDER BY seq ASC").iterate() as IterableIterator<AuditRow>;
  for (const row of rows) {
    count++;
    if (row.prev_hash !== prev) {
      return { ok: false, entries: count, brokenAtSeq: row.seq, reason: "Entry does not link to the previous entry (an entry before it was changed or removed)." };
    }
    const expected = hashEntry(prev, row);
    if (expected !== row.hash) {
      return { ok: false, entries: count, brokenAtSeq: row.seq, reason: "Entry contents do not match their recorded hash (the entry was edited)." };
    }
    prev = row.hash;
  }
  return { ok: true, entries: count, head: prev };
}
