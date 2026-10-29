import { z } from "zod";
import { audit } from "@/server/audit";
import { getDb, newId, nowIso } from "@/server/db";
import { HttpError, jsonBody, route, WRITE } from "@/server/http";

const schema = z.object({ body: z.string().trim().min(1).max(2000) });

export const POST = route({ roles: WRITE }, async ({ req, user, clientId, params, ip }) => {
  const { body } = schema.parse(await jsonBody(req));
  const db = getDb();
  const finding = await db.prepare("SELECT title FROM findings WHERE id=? AND client_id=?").get(params.id, clientId) as { title: string } | undefined;
  if (!finding) throw new HttpError(404, "Finding not found.");
  const id = newId();
  const createdAt = nowIso();
  await db.prepare("INSERT INTO finding_comments (id,finding_id,author,body,created_at) VALUES (?,?,?,?,?)").run(id, params.id, user.email, body, createdAt);
  await audit({ actor: user.email, action: "finding_comment_added", resource: finding.title.slice(0, 120), clientId, ip, details: `Follow-up comment added: ${body.slice(0, 300)}` }, db);
  return { id, author: user.email, body, created_at: createdAt };
});
