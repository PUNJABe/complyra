import { z } from "zod";
import { audit } from "@/server/audit";
import { getDb } from "@/server/db";
import { ADMIN, HttpError, jsonBody, route, WRITE } from "@/server/http";
import { channelStatus, enqueue, processOutbox, type Channel } from "@/server/notify";

export const GET = route({ roles: WRITE, noClient: true }, async () => {
  const db = getDb();
  return {
    channels: channelStatus(),
    counts: await db.prepare("SELECT status, COUNT(*) n FROM outbox GROUP BY status").all(),
    recent: await db.prepare("SELECT id, channel, title, status, attempts, max_attempts, last_error, next_attempt_at, created_at FROM outbox ORDER BY created_at DESC LIMIT 20").all(),
  };
});

export const POST = route({ roles: ADMIN, noClient: true }, async ({ req, user, ip }) => {
  const { action, channel } = z.object({ action: z.enum(["test", "process"]), channel: z.enum(["slack", "whatsapp"]).optional() }).parse(await jsonBody(req));
  const db = getDb();
  if (action === "test") {
    const st = channelStatus();
    const targets = (channel ? [channel] : (["slack", "whatsapp"] as Channel[])).filter((c) => st[c]);
    if (!targets.length) throw new HttpError(400, "No notification channel is configured. See .env.example.");
    for (const c of targets) await enqueue(db, c, "Test message", `Complyra test message sent by ${user.email}.`, null);
    await audit({ actor: user.email, action: "notification_test", resource: targets.join(","), ip, details: "Test notification queued." }, db);
  }
  return await processOutbox(db);
});
