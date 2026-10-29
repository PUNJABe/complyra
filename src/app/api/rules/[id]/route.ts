import { ruleInputSchema } from "@/lib/rules";
import { runAnalysis } from "@/server/analysis";
import { audit } from "@/server/audit";
import { getDb, nowIso } from "@/server/db";
import { HttpError, jsonBody, route, WRITE } from "@/server/http";
import { newId } from "@/server/db";
import { captureCurrentRule, savePolicyVersion } from "@/server/policy-workflow";

export const PUT = route({ roles: WRITE }, async ({ req, user, clientId, params, ip }) => {
  const input = ruleInputSchema.parse(await jsonBody(req));
  const db = getDb();
  const current = await captureCurrentRule(db,clientId,params.id);
  if (!current) throw new HttpError(404,"Rule not found.");
  if (user.role !== "admin") {
    const requestId = newId();
    await db.prepare("INSERT INTO policy_change_requests (id,client_id,rule_id,action,rule_json,requested_by,status,created_at) VALUES (?,?,?,'update',?,?,'pending',?)")
      .run(requestId,clientId,params.id,JSON.stringify(input),user.email,nowIso());
    await audit({ actor:user.email, action:"policy_change_requested", resource:input.name, clientId, ip, details:`Requested policy update: ${input.name}.` },db);
    return { requestId, pendingApproval:true };
  }
  await savePolicyVersion(db,clientId,params.id,current.name,"before_update",current,user.email);
  const r = await db.prepare("UPDATE rules SET name=?, kind=?, params_json=?, severity=?, enabled=?, updated_at=? WHERE id=? AND client_id=?")
    .run(input.name, input.kind, JSON.stringify(input.params), input.severity, input.enabled ? 1 : 0, nowIso(), params.id, clientId);
  if (!r.changes) throw new HttpError(404, "Rule not found.");
  await savePolicyVersion(db,clientId,params.id,input.name,"updated",input,user.email);
  await audit({ actor: user.email, action: "rule_updated", resource: input.name, clientId, ip, details: `Rule "${input.name}" updated: ${input.severity}, ${input.enabled ? "enabled" : "disabled"}, ${JSON.stringify(input.params)}` }, db);
  return { ok: true, analysis: await runAnalysis(clientId, user.email) };
});

export const DELETE = route({ roles: WRITE }, async ({ user, clientId, params, ip }) => {
  const db = getDb();
  const current = await captureCurrentRule(db,clientId,params.id);
  if (!current) throw new HttpError(404, "Rule not found.");
  if (user.role !== "admin") {
    const requestId = newId();
    await db.prepare("INSERT INTO policy_change_requests (id,client_id,rule_id,action,rule_json,requested_by,status,created_at) VALUES (?,?,?,'delete',?,?,'pending',?)")
      .run(requestId,clientId,params.id,JSON.stringify(current),user.email,nowIso());
    await audit({ actor:user.email, action:"policy_change_requested", resource:current.name, clientId, ip, details:`Requested policy deletion: ${current.name}.` },db);
    return { requestId, pendingApproval:true };
  }
  await savePolicyVersion(db,clientId,params.id,current.name,"deleted",current,user.email);
  await db.prepare("DELETE FROM rules WHERE id=?").run(params.id);
  await audit({ actor: user.email, action: "rule_deleted", resource: current.name, clientId, ip, severity: "warning", details: `Rule "${current.name}" deleted.` }, db);
  return { ok: true, analysis: await runAnalysis(clientId, user.email) };
});
