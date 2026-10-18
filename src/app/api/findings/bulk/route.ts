import { z } from "zod";
import { getDb } from "@/server/db";
import { jsonBody, route, WRITE } from "@/server/http";
import { reviewFinding, reviewSchema } from "@/server/findings";

const schema = reviewSchema.extend({ ids: z.array(z.string()).min(1).max(200) });

export const POST = route({ roles: WRITE }, async ({ req, user, clientId, ip }) => {
  const body = schema.parse(await jsonBody(req));
  const db = getDb();
  db.transaction(() => { for (const id of body.ids) reviewFinding(db, { id, clientId, status: body.status, note: body.note, actor: user.email, ip }); })();
  return { ok: true, updated: body.ids.length };
});
