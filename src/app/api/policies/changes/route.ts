import { z } from "zod";
import { ruleInputSchema } from "@/lib/rules";
import { audit } from "@/server/audit";
import { insertRule } from "@/server/bootstrap";
import { getDb, newId, nowIso } from "@/server/db";
import { ADMIN, HttpError, jsonBody, route, WRITE } from "@/server/http";
import { runAnalysis } from "@/server/analysis";
import { captureCurrentRule, savePolicyVersion } from "@/server/policy-workflow";

export const GET = route({}, async ({ clientId }) => (await getDb().prepare(
  "SELECT id,rule_id,action,rule_json,requested_by,status,reviewed_by,review_note,created_at,reviewed_at FROM policy_change_requests WHERE client_id=? ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,created_at DESC LIMIT 100",
).all(clientId)).map((row) => ({ ...row, rule: JSON.parse(String(row.rule_json)) })));

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), rule: ruleInputSchema }),
  z.object({ action: z.literal("update"), ruleId: z.string().uuid(), rule: ruleInputSchema }),
  z.object({ action: z.literal("delete"), ruleId: z.string().uuid() }),
]);

export const POST = route({ roles: WRITE }, async ({ req, user, clientId, ip }) => {
  const body = requestSchema.parse(await jsonBody(req));
  const db = getDb();
  let ruleId: string | null = null;
  let rule: unknown = null;
  if (body.action === "create") rule = body.rule;
  else {
    ruleId = body.ruleId;
    const current = await captureCurrentRule(db, clientId, ruleId);
    if (!current) throw new HttpError(404, "Rule not found.");
    rule = body.action === "delete" ? current : body.rule;
  }
  const id = newId();
  await db.prepare("INSERT INTO policy_change_requests (id,client_id,rule_id,action,rule_json,requested_by,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)")
    .run(id, clientId, ruleId, body.action, JSON.stringify(rule), user.email, nowIso());
  const name = (rule as { name?: string }).name ?? ruleId ?? "Policy";
  await audit({ actor:user.email, action:"policy_change_requested", resource:name, clientId, ip, details:`Requested policy ${body.action}: ${name}.` }, db);
  return { id, pendingApproval:true };
});

export const PATCH = route({ roles: ADMIN }, async ({ req, user, clientId, ip }) => {
  const { id, decision, note } = z.object({ id:z.string().uuid(), decision:z.enum(["approve","reject"]), note:z.string().trim().max(1000).default("") }).parse(await jsonBody(req));
  if (decision === "reject" && note.length < 3) throw new HttpError(400, "Add a short reason when rejecting a policy change.");
  const db = getDb();
  const change = await db.prepare("SELECT * FROM policy_change_requests WHERE id=? AND client_id=?").get(id, clientId) as { id:string; rule_id:string|null; action:string; rule_json:string; requested_by:string; status:string } | undefined;
  if (!change) throw new HttpError(404, "Policy change request not found.");
  if (change.status !== "pending") throw new HttpError(409, "This request has already been reviewed.");
  let analysis;
  if (decision === "approve") {
    const value = JSON.parse(change.rule_json) as Record<string, unknown>;
    if (change.action === "create") {
      const input = ruleInputSchema.parse(value);
      const ruleId = await insertRule(db, clientId, input);
      await savePolicyVersion(db, clientId, ruleId, input.name, "created", input, user.email);
    } else if (change.action === "update") {
      if (!change.rule_id) throw new HttpError(400, "The request has no rule reference.");
      const input = ruleInputSchema.parse(value);
      const old = await captureCurrentRule(db, clientId, change.rule_id);
      if (!old) throw new HttpError(404, "The rule was removed before this request was approved.");
      await savePolicyVersion(db,clientId,change.rule_id,old.name,"before_update",old,user.email);
      const updated = await db.prepare("UPDATE rules SET name=?,kind=?,params_json=?,severity=?,enabled=?,updated_at=? WHERE id=? AND client_id=?")
        .run(input.name,input.kind,JSON.stringify(input.params),input.severity,input.enabled?1:0,nowIso(),change.rule_id,clientId);
      if (!updated.changes) throw new HttpError(404, "Rule not found.");
      await savePolicyVersion(db,clientId,change.rule_id,input.name,"updated",input,user.email);
    } else {
      if (!change.rule_id) throw new HttpError(400, "The request has no rule reference.");
      const current = await captureCurrentRule(db,clientId,change.rule_id);
      if (!current) throw new HttpError(404,"The rule was already removed.");
      await savePolicyVersion(db,clientId,change.rule_id,current.name,"deleted",current,user.email);
      await db.prepare("DELETE FROM rules WHERE id=? AND client_id=?").run(change.rule_id,clientId);
    }
    analysis = await runAnalysis(clientId,user.email,db);
  }
  await db.prepare("UPDATE policy_change_requests SET status=?,reviewed_by=?,review_note=?,reviewed_at=? WHERE id=? AND status='pending'")
    .run(decision === "approve" ? "approved" : "rejected",user.email,note,nowIso(),id);
  const name = (JSON.parse(change.rule_json) as { name?:string }).name ?? change.rule_id ?? "Policy";
  await audit({ actor:user.email, action:`policy_change_${decision === "approve" ? "approved" : "rejected"}`, resource:name, clientId, ip, details:`${decision === "approve" ? "Approved" : "Rejected"} ${change.action} request from ${change.requested_by}.${note ? ` Note: ${note}` : ""}` },db);
  return { ok:true, analysis };
});
