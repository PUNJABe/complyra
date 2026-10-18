import { getDb } from "@/server/db";
import { route } from "@/server/http";

export const GET = route({}, ({ req, clientId }) => {
  const sp = new URL(req.url).searchParams;
  const where = ["client_id = @clientId"];
  const args: Record<string, unknown> = { clientId };
  const status = sp.get("status") ?? "open";
  if (status !== "all") { where.push("status = @status"); args.status = status; }
  if (sp.get("severity")) { where.push("severity = @severity"); args.severity = sp.get("severity"); }
  if (sp.get("kind")) { where.push("rule_kind = @kind"); args.kind = sp.get("kind"); }
  const q = sp.get("q")?.trim();
  if (q) { where.push("(title LIKE @q OR why LIKE @q OR evidence LIKE @q)"); args.q = `%${q.replace(/[%_]/g, "")}%`; }
  const rows = getDb().prepare(
    `SELECT id, rule_kind, rule_name, severity, title, why, evidence, amount_paise, status, reviewed_by, review_note, reviewed_at, first_seen_at, txn_ids_json
     FROM findings WHERE ${where.join(" AND ")}
     ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, amount_paise DESC LIMIT 500`,
  ).all(args) as (Record<string, unknown> & { txn_ids_json: string })[];
  return rows.map(({ txn_ids_json, ...r }) => ({ ...r, txnCount: (JSON.parse(txn_ids_json) as string[]).length }));
});
