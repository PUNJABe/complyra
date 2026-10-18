import { audit } from "@/server/audit";
import { getDb } from "@/server/db";
import { ADMIN, HttpError, jsonBody, route } from "@/server/http";
import { normaliseGstin } from "@/lib/gstin";
import { clientIdProblem, clientSchema } from "@/lib/client-schema";

export const PATCH = route({ roles: ADMIN, noClient: true }, async ({ req, user, params, ip }) => {
  const body = clientSchema.parse(await jsonBody(req));
  const problem = clientIdProblem(body.gstin, body.pan);
  if (problem) throw new HttpError(400, problem);
  const db = getDb();
  const r = db.prepare("UPDATE clients SET name=?, gstin=?, pan=?, sector=? WHERE id=?").run(body.name, body.gstin ? normaliseGstin(body.gstin) : "", body.pan.toUpperCase(), body.sector, params.id);
  if (!r.changes) throw new HttpError(404, "Client not found.");
  audit({ actor: user.email, action: "client_updated", resource: body.name, clientId: params.id, ip, details: `Client details updated for ${body.name}.` }, db);
  return { ok: true };
});
