import { getDb } from "@/server/db";
import { route } from "@/server/http";

export const GET = route({}, async ({ clientId }) => getDb().prepare(
  "SELECT rule_id,rule_name,version,change_type,rule_json,actor,created_at FROM policy_versions WHERE client_id=? ORDER BY created_at DESC LIMIT 50",
).all(clientId));
