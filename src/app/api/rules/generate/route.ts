import { z } from "zod";
import { ruleInputSchema } from "@/lib/rules";
import { AiError, complete, rulePrompt } from "@/server/ai";
import { audit } from "@/server/audit";
import { HttpError, jsonBody, route, WRITE } from "@/server/http";
import { hit } from "@/server/ratelimit";

const schema = z.object({ policyText: z.string().trim().min(20, "Paste a few sentences of your policy.").max(12000) });

/** Drafts rules from policy text. Nothing is saved: output is schema-validated and returned for the user to review. */
export const POST = route({ roles: WRITE }, async ({ req, user, clientId, ip }) => {
  if (!hit(`ai:${user.id}`, 10, 60_000).allowed) throw new HttpError(429, "Slow down: too many AI requests.");
  const { policyText } = schema.parse(await jsonBody(req));
  let text: string;
  try { text = await complete(rulePrompt(), policyText, { json: true }); }
  catch (e) { if (e instanceof AiError) throw new HttpError(503, e.message); throw e; }
  let raw: unknown[] = [];
  try { raw = (JSON.parse(text) as { rules?: unknown[] }).rules ?? []; } catch { throw new HttpError(502, "The AI returned something unreadable. Try again."); }
  const rules: z.infer<typeof ruleInputSchema>[] = [];
  const rejected: { index: number; reason: string }[] = [];
  raw.forEach((r, index) => {
    const p = ruleInputSchema.safeParse(r);
    if (p.success) rules.push(p.data); else rejected.push({ index, reason: p.error.issues[0]?.message ?? "Invalid rule" });
  });
  await audit({ actor: user.email, action: "rules_drafted_by_ai", resource: "rules", clientId, ip, details: `AI drafted ${rules.length} rule(s) from policy text; ${rejected.length} discarded as invalid.` });
  return { rules, rejected };
});
