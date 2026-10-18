import { audit } from "@/server/audit";
import { createClient, seedDefaultRules } from "@/server/bootstrap";
import { getDb } from "@/server/db";
import { ADMIN, HttpError, jsonBody, route } from "@/server/http";
import { clientIdProblem, clientSchema } from "@/lib/client-schema";

export const GET = route({ noClient: true }, () => getDb().prepare("SELECT id, name, gstin, pan, sector, currency FROM clients ORDER BY created_at").all());

export const POST = route({ roles: ADMIN, noClient: true }, async ({ req, user, ip }) => {
  const body = clientSchema.parse(await jsonBody(req));
  const problem = clientIdProblem(body.gstin, body.pan);
  if (problem) throw new HttpError(400, problem);
  const db = getDb();
  const id = db.transaction(() => {
    const cid = createClient(db, body);
    seedDefaultRules(db, cid);
    audit({ actor: user.email, action: "client_created", resource: body.name, clientId: cid, ip, details: `Client ${body.name} added with the default rule pack.` }, db);
    return cid;
  })();
  return { id };
});
