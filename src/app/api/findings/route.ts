import { getDb } from "@/server/db";
import { route } from "@/server/http";

export const GET = route({}, async ({ req, clientId }) => {
  const sp = new URL(req.url).searchParams;
  const where = ["client_id = @clientId"];
  const args: Record<string, unknown> = { clientId };
  const status = sp.get("status") ?? "open";
  if (status !== "all") { where.push("status = @status"); args.status = status; }
  if (sp.get("severity")) { where.push("severity = @severity"); args.severity = sp.get("severity"); }
  if (sp.get("kind")) { where.push("rule_kind = @kind"); args.kind = sp.get("kind"); }
  const q = sp.get("q")?.trim();
  if (q) { where.push("(title LIKE @q OR why LIKE @q OR evidence LIKE @q)"); args.q = `%${q.replace(/[%_]/g, "")}%`; }
  const rows = await getDb().prepare(
    `SELECT f.id, f.rule_kind, f.rule_name, f.severity, f.title, f.why, f.evidence, f.amount_paise, f.status, f.reviewed_by, f.review_note, f.reviewed_at, f.first_seen_at, f.txn_ids_json, t.assignee, t.due_date
     FROM findings f LEFT JOIN finding_tasks t ON t.finding_id=f.id WHERE ${where.map((w) => w.replaceAll("client_id", "f.client_id").replaceAll("status =", "f.status =").replaceAll("severity =", "f.severity =").replaceAll("rule_kind =", "f.rule_kind =").replaceAll("title LIKE", "f.title LIKE").replaceAll("why LIKE", "f.why LIKE").replaceAll("evidence LIKE", "f.evidence LIKE")).join(" AND ")}
     ORDER BY CASE f.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, f.amount_paise DESC LIMIT 500`,
  ).all(args) as (Record<string, unknown> & { txn_ids_json: string })[];
  return rows.map(({ txn_ids_json, ...r }) => ({ ...r, txnCount: (JSON.parse(txn_ids_json) as string[]).length }));
});
