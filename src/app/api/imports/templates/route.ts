import { z } from "zod";
import { audit } from "@/server/audit";
import { getDb, newId, nowIso } from "@/server/db";
import { HttpError, jsonBody, route, WRITE } from "@/server/http";

const schema = z.object({
  name: z.string().trim().min(2).max(60),
  dateOrder: z.enum(["dmy", "mdy"]),
  negatives: z.enum(["refund", "out"]),
  columnMapping: z.record(z.string(), z.string()).optional().default({}),
});

export const GET = route({}, async ({ clientId }) =>
  (await getDb().prepare("SELECT id,name,options_json,created_at FROM import_templates WHERE client_id=? ORDER BY name").all(clientId))
    .map((row) => ({ ...row, options: JSON.parse(String(row.options_json)) })),
);

export const POST = route({ roles: WRITE }, async ({ req, user, clientId, ip }) => {
  const input = schema.parse(await jsonBody(req));
  const db = getDb();
  if (await db.prepare("SELECT id FROM import_templates WHERE client_id=? AND name=?").get(clientId, input.name))
    throw new HttpError(409, "A saved setup already uses that name.");
  const id = newId();
  await db.prepare("INSERT INTO import_templates (id,client_id,name,options_json,created_by,created_at) VALUES (?,?,?,?,?,?)")
    .run(id, clientId, input.name, JSON.stringify({ dateOrder: input.dateOrder, negatives: input.negatives, columnMapping: input.columnMapping }), user.email, nowIso());
  await audit({ actor: user.email, action: "import_template_saved", resource: input.name, clientId, ip, details: `Saved import setup “${input.name}”.` }, db);
  return { id };
});
