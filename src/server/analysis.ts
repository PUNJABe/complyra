import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { evaluate, type EngineTxn, type Skipped } from "@/lib/engine";
import { ruleInputSchema, type StoredRule } from "@/lib/rules";
import { audit } from "./audit";
import { getDb, newId, nowIso } from "./db";

type RuleRow = { id: string; name: string; kind: string; params_json: string; severity: string; enabled: number };
type TxnRow = {
  id: string; txn_date: string; merchant: string; merchant_norm: string; amount_paise: number; direction: "debit" | "credit";
  employee: string; department: string; category: string; invoice_no: string; vendor_gstin: string; reference: string;
};

export function loadRules(clientId: string, db: Database.Database = getDb()): { rules: StoredRule[]; invalid: Skipped[] } {
  const rows = db.prepare("SELECT * FROM rules WHERE client_id = ? ORDER BY created_at ASC").all(clientId) as RuleRow[];
  const rules: StoredRule[] = [];
  const invalid: Skipped[] = [];
  for (const r of rows) {
    let params: unknown;
    try { params = JSON.parse(r.params_json); } catch { params = null; }
    // Re-validate so a hand-edited or outdated row can never crash the engine.
    const parsed = ruleInputSchema.safeParse({ name: r.name, kind: r.kind, severity: r.severity, enabled: !!r.enabled, params });
    if (!parsed.success) {
      invalid.push({ ruleId: r.id, ruleName: r.name, reason: "Rule settings are invalid. Open the rule and save it again." });
      continue;
    }
    rules.push({ id: r.id, name: r.name, kind: parsed.data.kind, severity: parsed.data.severity, enabled: parsed.data.enabled, params: parsed.data.params as Record<string, unknown> });
  }
  return { rules, invalid };
}

export function loadTxns(clientId: string, db: Database.Database = getDb()): EngineTxn[] {
  const rows = db.prepare("SELECT * FROM transactions WHERE client_id = ?").all(clientId) as TxnRow[];
  return rows.map((r) => ({
    id: r.id, date: r.txn_date, merchant: r.merchant, merchantNorm: r.merchant_norm, amountPaise: r.amount_paise,
    direction: r.direction, employee: r.employee, department: r.department, category: r.category,
    invoiceNo: r.invoice_no, vendorGstin: r.vendor_gstin, reference: r.reference,
  }));
}

const fingerprint = (clientId: string, ruleId: string, key: string) =>
  createHash("sha256").update(`${clientId}|${ruleId}|${key}`).digest("hex");

export type AnalysisSummary = {
  transactions: number;
  detections: number;
  created: number;
  updated: number;
  removed: number;
  skipped: Skipped[];
  newHigh: { title: string; why: string; amountPaise: number }[];
};

/**
 * Re-evaluates every enabled rule against all of the client's transactions and reconciles the findings table:
 *  - new issue            → inserted as "open"
 *  - issue still present  → details refreshed; reviewer decision and notes are preserved
 *  - open issue now gone  → removed (rule edited/deleted, or the import was removed)
 *  - reviewed issue gone  → kept, so the audit trail of decisions is never lost
 */
export function runAnalysis(clientId: string, actor: string, db: Database.Database = getDb()): AnalysisSummary {
  const client = db.prepare("SELECT currency FROM clients WHERE id = ?").get(clientId) as { currency: string } | undefined;
  const txns = loadTxns(clientId, db);
  const { rules, invalid } = loadRules(clientId, db);
  const { detections, skipped } = evaluate(rules, txns, { currency: client?.currency ?? "INR" });
  const now = nowIso();

  const summary: AnalysisSummary = {
    transactions: txns.length, detections: detections.length, created: 0, updated: 0, removed: 0,
    skipped: [...invalid, ...skipped], newHigh: [],
  };

  db.transaction(() => {
    const existing = db.prepare("SELECT id, fingerprint, status FROM findings WHERE client_id = ?").all(clientId) as { id: string; fingerprint: string; status: string }[];
    const byFp = new Map(existing.map((e) => [e.fingerprint, e]));
    const seen = new Set<string>();

    const insert = db.prepare(
      `INSERT INTO findings (id, client_id, fingerprint, rule_id, rule_kind, rule_name, severity, title, why, evidence, amount_paise, txn_ids_json, status, first_seen_at, last_seen_at)
       VALUES (@id, @client_id, @fingerprint, @rule_id, @rule_kind, @rule_name, @severity, @title, @why, @evidence, @amount_paise, @txn_ids_json, 'open', @now, @now)`,
    );
    const update = db.prepare(
      `UPDATE findings SET rule_id=@rule_id, rule_kind=@rule_kind, rule_name=@rule_name, severity=@severity, title=@title, why=@why,
         evidence=@evidence, amount_paise=@amount_paise, txn_ids_json=@txn_ids_json, last_seen_at=@now WHERE id=@id`,
    );

    for (const d of detections) {
      const fp = fingerprint(clientId, d.ruleId, d.key);
      seen.add(fp);
      const common = {
        rule_id: d.ruleId, rule_kind: d.kind, rule_name: d.ruleName, severity: d.severity, title: d.title, why: d.why,
        evidence: d.evidence, amount_paise: d.amountPaise, txn_ids_json: JSON.stringify(d.txnIds), now,
      };
      const hit = byFp.get(fp);
      if (hit) {
        update.run({ ...common, id: hit.id });
        summary.updated++;
      } else {
        insert.run({ ...common, id: newId(), client_id: clientId, fingerprint: fp });
        summary.created++;
        if (d.severity === "high") summary.newHigh.push({ title: d.title, why: d.why, amountPaise: d.amountPaise });
      }
    }

    const del = db.prepare("DELETE FROM findings WHERE id = ?");
    for (const e of existing) {
      if (!seen.has(e.fingerprint) && e.status === "open") {
        del.run(e.id);
        summary.removed++;
      }
    }

    db.prepare(
      `INSERT INTO analysis_runs (client_id, ran_at, txn_count, detections, skipped_json) VALUES (?,?,?,?,?)
       ON CONFLICT(client_id) DO UPDATE SET ran_at=excluded.ran_at, txn_count=excluded.txn_count, detections=excluded.detections, skipped_json=excluded.skipped_json`,
    ).run(clientId, now, txns.length, detections.length, JSON.stringify(summary.skipped));

    audit({
      actor, action: "analysis_run", resource: "findings", clientId,
      details: `Checked ${txns.length} transactions: ${summary.created} new, ${summary.updated} unchanged, ${summary.removed} cleared findings.`,
    }, db);
  })();

  return summary;
}
