import type Database from "better-sqlite3";
import { DEFAULT_RULES, ruleInputSchema, type RuleInput } from "@/lib/rules";
import { normaliseGstin } from "@/lib/gstin";
import { hashPassword, type Role } from "./auth";
import { audit } from "./audit";
import { getDb, newId, nowIso } from "./db";

export function hasUsers(db: Database.Database = getDb()): boolean {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n > 0;
}

export function createClient(
  db: Database.Database,
  c: { name: string; gstin?: string; pan?: string; sector?: string; currency?: string },
): string {
  const id = newId();
  db.prepare("INSERT INTO clients (id, name, gstin, pan, sector, currency, created_at) VALUES (?,?,?,?,?,?,?)").run(
    id, c.name.trim(), c.gstin ? normaliseGstin(c.gstin) : "", (c.pan ?? "").toUpperCase().trim(), (c.sector ?? "").trim(), c.currency ?? "INR", nowIso(),
  );
  return id;
}

export function insertRule(db: Database.Database, clientId: string, input: RuleInput): string {
  const r = ruleInputSchema.parse(input);
  const id = newId();
  const now = nowIso();
  db.prepare(
    "INSERT INTO rules (id, client_id, name, kind, params_json, severity, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(id, clientId, r.name, r.kind, JSON.stringify(r.params), r.severity, r.enabled ? 1 : 0, now, now);
  return id;
}

export function seedDefaultRules(db: Database.Database, clientId: string) {
  db.transaction(() => {
    for (const rule of DEFAULT_RULES) insertRule(db, clientId, rule);
  })();
}

export async function createUser(
  db: Database.Database,
  u: { email: string; name: string; password: string; role: Role },
): Promise<string> {
  const id = newId();
  const hash = await hashPassword(u.password);
  db.prepare("INSERT INTO users (id, email, name, password_hash, role, active, created_at) VALUES (?,?,?,?,?,1,?)").run(
    id, u.email.trim().toLowerCase(), u.name.trim(), hash, u.role, nowIso(),
  );
  return id;
}

/** First-run setup: only works while there are no users. Creates the admin, the first client and the default rule pack. */
export async function firstRunSetup(
  db: Database.Database,
  input: { email: string; name: string; password: string; clientName: string; gstin?: string; pan?: string; ip?: string },
): Promise<{ userId: string; clientId: string }> {
  if (hasUsers(db)) throw new Error("already_setup");
  const hash = await hashPassword(input.password);
  return db.transaction(() => {
    if (hasUsers(db)) throw new Error("already_setup"); // re-check inside the transaction
    const userId = newId();
    db.prepare("INSERT INTO users (id, email, name, password_hash, role, active, created_at) VALUES (?,?,?,?, 'admin',1,?)").run(
      userId, input.email.trim().toLowerCase(), input.name.trim(), hash, nowIso(),
    );
    const clientId = createClient(db, { name: input.clientName, gstin: input.gstin, pan: input.pan });
    seedDefaultRules(db, clientId);
    audit({ actor: input.email, action: "workspace_created", resource: "setup", clientId, ip: input.ip, details: `Workspace created for ${input.clientName}; admin account ${input.email}.` }, db);
    return { userId, clientId };
  })();
}
