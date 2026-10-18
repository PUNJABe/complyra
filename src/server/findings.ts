import { z } from "zod";
import type Database from "better-sqlite3";
import { audit } from "./audit";
import { getDb, nowIso } from "./db";
import { HttpError } from "./http";

export const reviewSchema = z.object({
  status: z.enum(["open", "confirmed", "dismissed", "escalated"]),
  note: z.string().trim().max(1000).default(""),
});

/** Dismissing or escalating needs a written reason: that rationale is what an auditor will ask for. */
export function reviewFinding(
  db: Database.Database, args: { id: string; clientId: string; status: string; note: string; actor: string; ip?: string },
): void {
  if ((args.status === "dismissed" || args.status === "escalated") && args.note.length < 3) {
    throw new HttpError(400, `Add a short note explaining why you are marking this ${args.status}.`);
  }
  const f = db.prepare("SELECT title, status FROM findings WHERE id = ? AND client_id = ?").get(args.id, args.clientId) as { title: string; status: string } | undefined;
  if (!f) throw new HttpError(404, "Finding not found.");
  db.transaction(() => {
    if (args.status === "open") {
      db.prepare("UPDATE findings SET status='open', reviewed_by=NULL, reviewed_at=NULL, review_note=NULL WHERE id=?").run(args.id);
    } else {
      db.prepare("UPDATE findings SET status=?, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?").run(args.status, args.actor, nowIso(), args.note, args.id);
    }
    audit({
      actor: args.actor, action: `finding_${args.status === "open" ? "reopened" : args.status}`, resource: f.title.slice(0, 120), clientId: args.clientId, ip: args.ip,
      severity: args.status === "dismissed" ? "warning" : "info",
      details: `${f.status} → ${args.status}${args.note ? `. Note: ${args.note}` : ""}`,
    }, db);
  })();
}

export { getDb };
