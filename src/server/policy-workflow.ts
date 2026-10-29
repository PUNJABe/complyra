import type { RuleInput } from "@/lib/rules";
import type { DatabaseLike } from "./db";
import { newId, nowIso } from "./db";

export async function savePolicyVersion(db: DatabaseLike, clientId: string, ruleId: string, ruleName: string, changeType: string, value: unknown, actor: string) {
  const row = await db.prepare("SELECT COALESCE(MAX(version),0) version FROM policy_versions WHERE client_id=? AND rule_id=?").get(clientId, ruleId) as { version: number };
  await db.prepare("INSERT INTO policy_versions (id,client_id,rule_id,rule_name,version,change_type,rule_json,actor,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(newId(), clientId, ruleId, ruleName, row.version + 1, changeType, JSON.stringify(value), actor, nowIso());
}

export async function captureCurrentRule(db: DatabaseLike, clientId: string, ruleId: string) {
  const r = await db.prepare("SELECT id,name,kind,params_json,severity,enabled FROM rules WHERE id=? AND client_id=?").get(ruleId, clientId) as { id:string; name:string; kind:string; params_json:string; severity:string; enabled:number } | undefined;
  if (!r) return null;
  return { id:r.id, name:r.name, kind:r.kind, params:JSON.parse(r.params_json) as RuleInput["params"], severity:r.severity, enabled:Boolean(r.enabled) };
}
