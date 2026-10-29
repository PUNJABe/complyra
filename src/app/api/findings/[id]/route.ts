import { getDb } from "@/server/db";
import { HttpError, jsonBody, route, WRITE } from "@/server/http";
import { reviewFinding, reviewSchema } from "@/server/findings";
import { audit } from "@/server/audit";
import { nowIso } from "@/server/db";
import { z } from "zod";

export const GET = route({}, async ({ clientId, params }) => {
  const db = getDb();
  const f = (await db.prepare("SELECT * FROM findings WHERE id = ? AND client_id = ?").get(params.id, clientId)) as (Record<string, unknown> & { txn_ids_json: string }) | undefined;
  if (!f) throw new HttpError(404, "Finding not found.");
  const ids = (JSON.parse(f.txn_ids_json) as string[]).slice(0, 100);
  const txns = ids.length ? await db.prepare(`SELECT id, txn_date date, merchant, amount_paise amountPaise, direction, employee, department, category, invoice_no invoiceNo, vendor_gstin vendorGstin, reference FROM transactions WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY txn_date`).all(...ids) : [];
  const task = await db.prepare("SELECT assignee,due_date FROM finding_tasks WHERE finding_id=?").get(params.id) as { assignee: string | null; due_date: string | null } | undefined;
  const comments = await db.prepare("SELECT id,author,body,created_at FROM finding_comments WHERE finding_id=? ORDER BY created_at").all(params.id);
  const assignees = await db.prepare("SELECT email,name FROM users WHERE active=1 AND role IN ('admin','reviewer') ORDER BY name").all();
  const { txn_ids_json, ...rest } = f;
  void txn_ids_json;
  return { ...rest, ...task, assignees, comments, transactions: txns };
});

export const PATCH = route({ roles: WRITE }, async ({ req, user, clientId, params, ip }) => {
  const raw = await jsonBody<Record<string, unknown>>(req);
  if ("status" in raw) {
    const body = reviewSchema.parse(raw);
    await reviewFinding(getDb(), { id: params.id, clientId, status: body.status, note: body.note, actor: user.email, ip });
    return { ok: true };
  }
  const body = z.object({ assignee: z.string().email().nullable().optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).refine((v) => v.assignee !== undefined || v.dueDate !== undefined).parse(raw);
  const db = getDb();
  const finding = await db.prepare("SELECT title FROM findings WHERE id=? AND client_id=?").get(params.id, clientId) as { title: string } | undefined;
  if (!finding) throw new HttpError(404, "Finding not found.");
  if (body.assignee) {
    const person = await db.prepare("SELECT email FROM users WHERE email=? AND active=1 AND role IN ('admin','reviewer')").get(body.assignee);
    if (!person) throw new HttpError(400, "Choose an active admin or reviewer.");
  }
  const existing = await db.prepare("SELECT assignee,due_date FROM finding_tasks WHERE finding_id=?").get(params.id) as { assignee: string | null; due_date: string | null } | undefined;
  const assignee = body.assignee === undefined ? existing?.assignee ?? null : body.assignee;
  const dueDate = body.dueDate === undefined ? existing?.due_date ?? null : body.dueDate;
  await db.prepare("INSERT INTO finding_tasks (finding_id,assignee,due_date,updated_by,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(finding_id) DO UPDATE SET assignee=excluded.assignee,due_date=excluded.due_date,updated_by=excluded.updated_by,updated_at=excluded.updated_at")
    .run(params.id, assignee, dueDate, user.email, nowIso());
  await audit({ actor: user.email, action: "finding_assigned", resource: finding.title.slice(0, 120), clientId, ip, details: `Assignment updated: ${assignee ?? "unassigned"}; due ${dueDate ?? "not set"}.` }, db);
  return { ok: true };
});
