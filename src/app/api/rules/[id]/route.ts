import { ruleInputSchema } from "@/lib/rules";
import { runAnalysis } from "@/server/analysis";
import { audit } from "@/server/audit";
import { getDb, nowIso } from "@/server/db";
import { HttpError, jsonBody, route, WRITE } from "@/server/http";

export const PUT = route({ roles: WRITE }, async ({ req, user, clientId, params, ip }) => {
  const input = ruleInputSchema.parse(await jsonBody(req));
  const db = getDb();
  const r = await db.prepare("UPDATE rules SET name=?, kind=?, params_json=?, severity=?, enabled=?, updated_at=? WHERE id=? AND client_id=?")
    .run(input.name, input.kind, JSON.stringify(input.params), input.severity, input.enabled ? 1 : 0, nowIso(), params.id, clientId);
  if (!r.changes) throw new HttpError(404, "Rule not found.");
  await audit({ actor: user.email, action: "rule_updated", resource: input.name, clientId, ip, details: `Rule "${input.name}" updated: ${input.severity}, ${input.enabled ? "enabled" : "disabled"}, ${JSON.stringify(input.params)}` }, db);
  return { ok: true, analysis: await runAnalysis(clientId, user.email) };
});

export const DELETE = route({ roles: WRITE }, async ({ user, clientId, params, ip }) => {
  const db = getDb();
  const rule = (await db.prepare("SELECT name FROM rules WHERE id=? AND client_id=?").get(params.id, clientId)) as { name: string } | undefined;
  if (!rule) throw new HttpError(404, "Rule not found.");
  await db.prepare("DELETE FROM rules WHERE id=?").run(params.id);
  await audit({ actor: user.email, action: "rule_deleted", resource: rule.name, clientId, ip, severity: "warning", details: `Rule "${rule.name}" deleted.` }, db);
  return { ok: true, analysis: await runAnalysis(clientId, user.email) };
});
