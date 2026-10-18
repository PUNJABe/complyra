import { getDb } from "@/server/db";
import { route } from "@/server/http";

export const GET = route({}, ({ req, clientId }) => {
  const db = getDb();
  const sp = new URL(req.url).searchParams;
  const where = ["t.client_id = @clientId"];
  const args: Record<string, unknown> = { clientId };
  const q = sp.get("q")?.trim();
  if (q) { where.push("(t.merchant LIKE @q OR t.employee LIKE @q OR t.reference LIKE @q OR t.invoice_no LIKE @q)"); args.q = `%${q.replace(/[%_]/g, "")}%`; }
  for (const [param, col] of [["category", "category"], ["department", "department"], ["employee", "employee"], ["direction", "direction"]] as const) {
    const v = sp.get(param);
    if (v) { where.push(`t.${col} = @${param}`); args[param] = v === "__none" ? "" : v; }
  }
  if (sp.get("from")) { where.push("t.txn_date >= @from"); args.from = sp.get("from"); }
  if (sp.get("to")) { where.push("t.txn_date <= @to"); args.to = sp.get("to"); }

  // Which transactions are in an open/escalated finding, and the worst severity among them.
  const rank: Record<string, number> = { low: 1, medium: 2, high: 3 };
  const flags = new Map<string, string>();
  for (const f of db.prepare("SELECT severity, txn_ids_json FROM findings WHERE client_id = ? AND status IN ('open','escalated') AND rule_kind != 'monthly_limit'").all(clientId) as { severity: string; txn_ids_json: string }[]) {
    for (const id of JSON.parse(f.txn_ids_json) as string[]) if ((rank[flags.get(id) ?? ""] ?? 0) < rank[f.severity]) flags.set(id, f.severity);
  }
  const flagged = sp.get("flagged");
  if (flagged === "1") { const ids = [...flags.keys()]; where.push(`t.id IN (${ids.length ? ids.map((_, i) => `@f${i}`).join(",") : "NULL"})`); ids.forEach((id, i) => (args[`f${i}`] = id)); }

  const w = where.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN direction='debit' THEN amount_paise ELSE 0 END) spend FROM transactions t WHERE ${w}`).get(args) as { n: number; spend: number | null };
  const pageSize = Math.min(Math.max(parseInt(sp.get("pageSize") ?? "50", 10) || 50, 10), 200);
  const page = Math.max(parseInt(sp.get("page") ?? "1", 10) || 1, 1);
  const rows = db.prepare(`SELECT t.* FROM transactions t WHERE ${w} ORDER BY t.txn_date DESC, t.merchant LIMIT @limit OFFSET @offset`).all({ ...args, limit: pageSize, offset: (page - 1) * pageSize }) as Record<string, unknown>[];

  const distinct = (col: string) => (db.prepare(`SELECT DISTINCT ${col} v FROM transactions WHERE client_id = ? AND ${col} != '' ORDER BY 1`).all(clientId) as { v: string }[]).map((r) => r.v);
  return {
    total: total.n, spendPaise: total.spend ?? 0, page, pageSize,
    rows: rows.map((r) => ({
      id: r.id, hash: r.row_hash, date: r.txn_date, merchant: r.merchant, amountPaise: r.amount_paise, direction: r.direction, employee: r.employee, department: r.department,
      category: r.category, invoiceNo: r.invoice_no, vendorGstin: r.vendor_gstin, reference: r.reference, flag: flags.get(r.id as string) ?? null,
    })),
    facets: { categories: distinct("category"), departments: distinct("department"), employees: distinct("employee") },
  };
});
