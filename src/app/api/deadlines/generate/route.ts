import { z } from "zod";
import { audit } from "@/server/audit";
import { getDb, newId, nowIso } from "@/server/db";
import { jsonBody, route, WRITE } from "@/server/http";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Adds the usual monthly reminders for the next N months. These are the *standard* dates (GSTR-1 on the 11th,
 * GSTR-3B on the 20th, TDS payment on the 7th). The government extends or changes dates by notification, and
 * QRMP filers differ, so each label says to verify. Existing identical reminders are skipped.
 */
export const POST = route({ roles: WRITE }, async ({ req, user, clientId, ip }) => {
  const { months } = z.object({ months: z.number().int().min(1).max(12).default(3) }).parse(await jsonBody(req).catch(() => ({})));
  const db = getDb();
  const now = new Date();
  const exists = db.prepare("SELECT 1 FROM deadlines WHERE client_id=? AND label=? AND due_date=?");
  const insert = db.prepare("INSERT INTO deadlines (id, client_id, kind, label, due_date, created_at) VALUES (?,?,?,?,?,?)");
  let added = 0;
  db.transaction(() => {
    for (let i = 1; i <= months; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      const y = d.getUTCFullYear(), m = d.getUTCMonth();
      const prev = MON[(m + 11) % 12];
      const ymd = (day: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      for (const [kind, label, day] of [
        ["TDS", `TDS payment for ${prev} (standard date, verify)`, 7],
        ["GST", `GSTR-1 for ${prev} (standard date, verify)`, 11],
        ["GST", `GSTR-3B for ${prev} (standard date, verify)`, 20],
      ] as const) {
        if (exists.get(clientId, label, ymd(day))) continue;
        insert.run(newId(), clientId, kind, label, ymd(day), nowIso());
        added++;
      }
    }
    audit({ actor: user.email, action: "deadlines_generated", resource: "deadlines", clientId, ip, details: `Added ${added} standard monthly reminders.` }, db);
  })();
  return { added };
});
