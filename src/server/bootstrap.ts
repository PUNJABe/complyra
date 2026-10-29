import type { DatabaseLike } from "./db";
import { DEFAULT_RULES, ruleInputSchema, type RuleInput } from "@/lib/rules";
import { normaliseGstin } from "@/lib/gstin";
import { hashPassword, type Role } from "./auth";
import { audit } from "./audit";
import { getDb, newId, nowIso } from "./db";

export async function hasUsers(db: DatabaseLike = getDb()): Promise<boolean> {
  return (((await db.prepare("SELECT COUNT(*) AS n FROM users").get())) as { n: number }).n > 0;
}

export async function createClient(
  db: DatabaseLike,
  c: { name: string; gstin?: string; pan?: string; sector?: string; currency?: string },
): Promise<string> {
  const id = newId();
  await db.prepare("INSERT INTO clients (id, name, gstin, pan, sector, currency, created_at) VALUES (?,?,?,?,?,?,?)").run(
    id, c.name.trim(), c.gstin ? normaliseGstin(c.gstin) : "", (c.pan ?? "").toUpperCase().trim(), (c.sector ?? "").trim(), c.currency ?? "INR", nowIso(),
  );
  return id;
}

export async function insertRule(db: DatabaseLike, clientId: string, input: RuleInput): Promise<string> {
  const r = ruleInputSchema.parse(input);
  const id = newId();
  const now = nowIso();
  await db.prepare(
    "INSERT INTO rules (id, client_id, name, kind, params_json, severity, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(id, clientId, r.name, r.kind, JSON.stringify(r.params), r.severity, r.enabled ? 1 : 0, now, now);
  return id;
}

export async function seedDefaultRules(db: DatabaseLike, clientId: string) {
  for (const rule of DEFAULT_RULES) await insertRule(db, clientId, rule);
}

export async function createUser(
  db: DatabaseLike,
  u: { email: string; name: string; password: string; role: Role },
): Promise<string> {
  const id = newId();
  const hash = await hashPassword(u.password);
  await db.prepare("INSERT INTO users (id, email, name, password_hash, role, active, created_at) VALUES (?,?,?,?,?,1,?)").run(
    id, u.email.trim().toLowerCase(), u.name.trim(), hash, u.role, nowIso(),
  );
  return id;
}

/** First-run setup: only works while there are no users. Creates the admin, the first client and the default rule pack. */
export async function firstRunSetup(
  db: DatabaseLike,
  input: { email: string; name: string; password: string; clientName: string; gstin?: string; pan?: string; ip?: string },
): Promise<{ userId: string; clientId: string }> {
  if (await hasUsers(db)) throw new Error("already_setup");
  const hash = await hashPassword(input.password);
  return db.transaction(async () => {
    if (await hasUsers(db)) throw new Error("already_setup"); // re-check inside the transaction
    const userId = newId();
    await db.prepare("INSERT INTO users (id, email, name, password_hash, role, active, created_at) VALUES (?,?,?,?, 'admin',1,?)").run(
      userId, input.email.trim().toLowerCase(), input.name.trim(), hash, nowIso(),
    );
    const clientId = await createClient(db, { name: input.clientName, gstin: input.gstin, pan: input.pan });
    await seedDefaultRules(db, clientId);
    await audit({ actor: input.email, action: "workspace_created", resource: "setup", clientId, ip: input.ip, details: `Workspace created for ${input.clientName}; admin account ${input.email}.` }, db);
    return { userId, clientId };
  });
}
