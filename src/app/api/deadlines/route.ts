import { z } from "zod";
import { audit } from "@/server/audit";
import { getDb, newId, nowIso } from "@/server/db";
import { jsonBody, route, WRITE } from "@/server/http";
import { todayIso } from "@/lib/dates";

const schema = z.object({
  kind: z.enum(["GST", "TDS", "ITR", "OTHER"]),
  label: z.string().trim().min(2).max(120),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date"),
});

export const GET = route({}, ({ clientId }) => {
  const today = todayIso();
  const rows = getDb().prepare("SELECT id, kind, label, due_date, done, done_at FROM deadlines WHERE client_id = ? ORDER BY done, due_date").all(clientId) as { id: string; kind: string; label: string; due_date: string; done: number; done_at: string | null }[];
  return rows.map((r) => ({ id: r.id, kind: r.kind, label: r.label, dueDate: r.due_date, done: !!r.done, doneAt: r.done_at, overdue: !r.done && r.due_date < today }));
});

export const POST = route({ roles: WRITE }, async ({ req, user, clientId, ip }) => {
  const b = schema.parse(await jsonBody(req));
  const db = getDb();
  const id = newId();
  db.prepare("INSERT INTO deadlines (id, client_id, kind, label, due_date, created_at) VALUES (?,?,?,?,?,?)").run(id, clientId, b.kind, b.label, b.dueDate, nowIso());
  audit({ actor: user.email, action: "deadline_added", resource: b.label, clientId, ip, details: `${b.kind} deadline "${b.label}" due ${b.dueDate}.` }, db);
  return { id };
});
