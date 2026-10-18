import { z } from "zod";
import { audit } from "@/server/audit";
import { getDb, nowIso } from "@/server/db";
import { HttpError, jsonBody, route, WRITE } from "@/server/http";

export const PATCH = route({ roles: WRITE }, async ({ req, user, clientId, params, ip }) => {
  const { done } = z.object({ done: z.boolean() }).parse(await jsonBody(req));
  const db = getDb();
  const d = db.prepare("SELECT label FROM deadlines WHERE id=? AND client_id=?").get(params.id, clientId) as { label: string } | undefined;
  if (!d) throw new HttpError(404, "Deadline not found.");
  db.prepare("UPDATE deadlines SET done=?, done_at=? WHERE id=?").run(done ? 1 : 0, done ? nowIso() : null, params.id);
  audit({ actor: user.email, action: done ? "deadline_completed" : "deadline_reopened", resource: d.label, clientId, ip, details: `Deadline "${d.label}" marked ${done ? "filed" : "pending"}.` }, db);
  return { ok: true };
});

export const DELETE = route({ roles: WRITE }, ({ user, clientId, params, ip }) => {
  const db = getDb();
  const d = db.prepare("SELECT label FROM deadlines WHERE id=? AND client_id=?").get(params.id, clientId) as { label: string } | undefined;
  if (!d) throw new HttpError(404, "Deadline not found.");
  db.prepare("DELETE FROM deadlines WHERE id=?").run(params.id);
  audit({ actor: user.email, action: "deadline_deleted", resource: d.label, clientId, ip, details: `Deadline "${d.label}" removed.` }, db);
  return { ok: true };
});
