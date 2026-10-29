import { z } from "zod";
import { audit } from "@/server/audit";
import { passwordProblem } from "@/server/auth";
import { createUser } from "@/server/bootstrap";
import { getDb } from "@/server/db";
import { ADMIN, HttpError, jsonBody, route } from "@/server/http";

export const GET = route({ roles: ADMIN, noClient: true }, async () =>
  await getDb().prepare("SELECT id, email, name, role, active, created_at FROM users ORDER BY created_at").all(),
);

const schema = z.object({ email: z.email(), name: z.string().trim().min(2).max(80), password: z.string().max(200), role: z.enum(["admin", "reviewer", "viewer"]) });

export const POST = route({ roles: ADMIN, noClient: true }, async ({ req, user, ip }) => {
  const b = schema.parse(await jsonBody(req));
  const problem = passwordProblem(b.password);
  if (problem) throw new HttpError(400, problem);
  const db = getDb();
  if (await db.prepare("SELECT 1 FROM users WHERE email = ?").get(b.email)) throw new HttpError(409, "A user with this email already exists.");
  const id = await createUser(db, b);
  await audit({ actor: user.email, action: "user_created", resource: b.email, ip, severity: "warning", details: `User ${b.email} created with role ${b.role}.` }, db);
  return { id };
});
