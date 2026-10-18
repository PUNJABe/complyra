import { z } from "zod";
import { audit } from "@/server/audit";
import { hashPassword, passwordProblem } from "@/server/auth";
import { getDb } from "@/server/db";
import { ADMIN, HttpError, jsonBody, route } from "@/server/http";

const schema = z.object({ role: z.enum(["admin", "reviewer", "viewer"]).optional(), active: z.boolean().optional(), password: z.string().max(200).optional() });

export const PATCH = route({ roles: ADMIN, noClient: true }, async ({ req, user, params, ip }) => {
  const b = schema.parse(await jsonBody(req));
  const db = getDb();
  const target = db.prepare("SELECT id, email, role, active FROM users WHERE id = ?").get(params.id) as { id: string; email: string; role: string; active: number } | undefined;
  if (!target) throw new HttpError(404, "User not found.");

  const losesAdmin = target.role === "admin" && target.active === 1 && ((b.role && b.role !== "admin") || b.active === false);
  if (losesAdmin) {
    const admins = (db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").get() as { n: number }).n;
    if (admins <= 1) throw new HttpError(400, "This is the only active admin. Make someone else an admin first.");
  }
  if (target.id === user.id && b.active === false) throw new HttpError(400, "You cannot deactivate your own account.");

  const changes: string[] = [];
  db.transaction(() => {
    if (b.role) { db.prepare("UPDATE users SET role=? WHERE id=?").run(b.role, target.id); changes.push(`role ${target.role} → ${b.role}`); }
    if (b.active !== undefined) { db.prepare("UPDATE users SET active=? WHERE id=?").run(b.active ? 1 : 0, target.id); changes.push(b.active ? "reactivated" : "deactivated"); }
    audit({ actor: user.email, action: "user_updated", resource: target.email, ip, severity: "warning", details: `${target.email}: ${changes.join(", ") || "password reset"}` }, db);
  })();
  if (b.password) {
    const problem = passwordProblem(b.password);
    if (problem) throw new HttpError(400, problem);
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(await hashPassword(b.password), target.id);
    audit({ actor: user.email, action: "user_password_reset", resource: target.email, ip, severity: "warning", details: `Password reset for ${target.email}.` }, db);
  }
  return { ok: true };
});
