import { KIND_META, ruleInputSchema } from "@/lib/rules";
import { runAnalysis, loadRules } from "@/server/analysis";
import { audit } from "@/server/audit";
import { insertRule } from "@/server/bootstrap";
import { getDb } from "@/server/db";
import { jsonBody, route, WRITE } from "@/server/http";

export const GET = route({}, async ({ clientId }) => {
  const db = getDb();
  const rows = (await db.prepare("SELECT id, name, kind, params_json, severity, enabled FROM rules WHERE client_id = ? ORDER BY created_at").all(clientId)) as { id: string; name: string; kind: string; params_json: string; severity: string; enabled: number }[];
  const counts = new Map(((await db.prepare("SELECT rule_id, COUNT(*) n FROM findings WHERE client_id = ? AND status='open' GROUP BY rule_id").all(clientId)) as { rule_id: string; n: number }[]).map((r) => [r.rule_id, r.n]));
  const run = (await db.prepare("SELECT skipped_json, ran_at FROM analysis_runs WHERE client_id = ?").get(clientId)) as { skipped_json: string; ran_at: string } | undefined;
  void loadRules;
  return {
    rules: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, severity: r.severity, enabled: !!r.enabled, params: JSON.parse(r.params_json), openFindings: counts.get(r.id) ?? 0 })),
    kinds: Object.values(KIND_META),
    skipped: run ? JSON.parse(run.skipped_json) : [],
    ranAt: run?.ran_at ?? null,
  };
});

export const POST = route({ roles: WRITE }, async ({ req, user, clientId, ip }) => {
  const input = ruleInputSchema.parse(await jsonBody(req));
  const db = getDb();
  const id = await insertRule(db, clientId, input);
  await audit({ actor: user.email, action: "rule_created", resource: input.name, clientId, ip, details: `Rule "${input.name}" (${input.kind}, ${input.severity}) created.` }, db);
  return { id, analysis: await runAnalysis(clientId, user.email) };
});
