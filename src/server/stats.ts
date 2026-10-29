import type { DatabaseLike } from "./db";
import { getDb } from "./db";

type Sev = "high" | "medium" | "low";

export async function dashboardStats(clientId: string, db: DatabaseLike = getDb()) {
  const one = async <T,>(sql: string, ...args: unknown[]) => (await db.prepare(sql).get(...args)) as T;
  const all = async <T,>(sql: string, ...args: unknown[]) => (await db.prepare(sql).all(...args)) as T[];

  const totals = await one<{ spend: number | null; debits: number; credit: number | null; credits: number; first: string | null; last: string | null }>(
    `SELECT SUM(CASE WHEN direction='debit' THEN amount_paise END) spend,
            SUM(CASE WHEN direction='debit' THEN 1 ELSE 0 END) debits,
            SUM(CASE WHEN direction='credit' THEN amount_paise END) credit,
            SUM(CASE WHEN direction='credit' THEN 1 ELSE 0 END) credits, MIN(txn_date) first, MAX(txn_date) last
     FROM transactions WHERE client_id = ?`, clientId);

  const byMonth = await all<{ month: string; paise: number }>(
    `SELECT substr(txn_date,1,7) month, SUM(amount_paise) paise FROM transactions
     WHERE client_id = ? AND direction='debit' GROUP BY 1 ORDER BY 1`, clientId);

  const group = async (col: "category" | "department", empty: string) =>
    all<{ name: string; paise: number; count: number }>(
      `SELECT CASE WHEN ${col}='' THEN ? ELSE ${col} END name, SUM(amount_paise) paise, COUNT(*) count
       FROM transactions WHERE client_id = ? AND direction='debit' GROUP BY 1 ORDER BY paise DESC LIMIT 8`, empty, clientId);

  const topMerchants = await all<{ name: string; paise: number; count: number }>(
    `SELECT MIN(merchant) name, SUM(amount_paise) paise, COUNT(*) count FROM transactions
     WHERE client_id = ? AND direction='debit' GROUP BY merchant_norm ORDER BY paise DESC LIMIT 8`, clientId);

  const statusRows = await all<{ status: string; n: number }>("SELECT status, COUNT(*) n FROM findings WHERE client_id = ? GROUP BY status", clientId);
  const status: { open: number; confirmed: number; dismissed: number; escalated: number } = { open: 0, confirmed: 0, dismissed: 0, escalated: 0 };
  for (const r of statusRows) status[r.status as keyof typeof status] = r.n;

  const sevRows = await all<{ severity: Sev; n: number }>("SELECT severity, COUNT(*) n FROM findings WHERE client_id = ? AND status='open' GROUP BY severity", clientId);
  const openBySeverity: Record<Sev, number> = { high: 0, medium: 0, low: 0 };
  for (const r of sevRows) openBySeverity[r.severity] = r.n;

  // Distinct transactions in open findings. Budget findings cover a whole group, so they are left out of this figure.
  const idRows = await all<{ ids: string }>("SELECT txn_ids_json ids FROM findings WHERE client_id = ? AND status='open' AND rule_kind != 'monthly_limit'", clientId);
  const flagged = new Set<string>();
  for (const r of idRows) for (const id of JSON.parse(r.ids) as string[]) flagged.add(id);
  let flaggedSpend = 0;
  const ids = [...flagged];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const row = (await db.prepare(`SELECT SUM(amount_paise) s FROM transactions WHERE direction='debit' AND id IN (${chunk.map(() => "?").join(",")})`).get(...chunk)) as { s: number | null };
    flaggedSpend += row.s ?? 0;
  }

  const run = await db.prepare("SELECT ran_at, txn_count, detections, skipped_json FROM analysis_runs WHERE client_id = ?").get(clientId) as
    | { ran_at: string; txn_count: number; detections: number; skipped_json: string } | undefined;

  const debits = totals.debits ?? 0;
  return {
    totals: { spendPaise: totals.spend ?? 0, debitCount: debits, creditPaise: totals.credit ?? 0, creditCount: totals.credits ?? 0, firstDate: totals.first, lastDate: totals.last,
      imports: (await one<{ n: number }>("SELECT COUNT(*) n FROM imports WHERE client_id = ?", clientId)).n },
    byMonth,
    byCategory: await group("category", "Uncategorised"),
    byDepartment: await group("department", "Unassigned"),
    topMerchants,
    findings: { ...status, openBySeverity, flaggedTransactions: flagged.size, flaggedSpendPaise: flaggedSpend },
    cleanRate: debits ? Math.round((1 - Math.min(flagged.size, debits) / debits) * 1000) / 10 : null,
    lastAnalysis: run ? { ranAt: run.ran_at, transactions: run.txn_count, detections: run.detections, skipped: JSON.parse(run.skipped_json) as { ruleId: string; ruleName: string; reason: string }[] } : null,
  };
}
