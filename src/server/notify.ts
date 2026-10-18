import type Database from "better-sqlite3";
import { formatMoney } from "@/lib/money";
import { getDb, newId, nowIso } from "./db";

export type Channel = "slack" | "whatsapp";

const SLACK_HOST = /^https:\/\/hooks\.slack(-gov)?\.com\//;

export function channelStatus() {
  return {
    slack: Boolean(process.env.SLACK_WEBHOOK_URL),
    whatsapp: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TO_NUMBER),
  };
}

export function enqueue(db: Database.Database, channel: Channel, title: string, message: string, clientId: string | null) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO outbox (id, client_id, channel, title, message, status, attempts, max_attempts, next_attempt_at, created_at, updated_at)
     VALUES (?,?,?,?,?,'queued',0,5,?,?,?)`,
  ).run(newId(), clientId, channel, title, message.slice(0, 3500), now, now, now);
}

/** One summary message per configured channel when an analysis surfaces new high-severity findings. */
export function notifyNewHighFindings(
  clientId: string, clientName: string, currency: string,
  newHigh: { title: string; amountPaise: number }[], db: Database.Database = getDb(),
) {
  if (!newHigh.length) return;
  const st = channelStatus();
  const lines = newHigh.slice(0, 8).map((f) => `• ${f.title} (${formatMoney(f.amountPaise, currency)})`);
  const more = newHigh.length > 8 ? `\n…and ${newHigh.length - 8} more` : "";
  const message = `Complyra: ${newHigh.length} new high-severity finding${newHigh.length === 1 ? "" : "s"} for ${clientName}\n${lines.join("\n")}${more}`;
  (["slack", "whatsapp"] as Channel[]).forEach((ch) => st[ch] && enqueue(db, ch, "New high-severity findings", message, clientId));
}

type Sent = { ok: boolean; status?: number; providerId?: string; error?: string };

async function sendSlack(message: string): Promise<Sent> {
  const url = process.env.SLACK_WEBHOOK_URL ?? "";
  if (!SLACK_HOST.test(url)) return { ok: false, error: "SLACK_WEBHOOK_URL must be a Slack incoming-webhook URL (https://hooks.slack.com/...)." };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: message }), signal: AbortSignal.timeout(10_000) });
  return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `Slack responded ${res.status}: ${(await res.text()).slice(0, 120)}` };
}

async function sendWhatsApp(message: string): Promise<Sent> {
  const { WHATSAPP_ACCESS_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: id, WHATSAPP_TO_NUMBER: to } = process.env;
  if (!token || !id || !to) return { ok: false, error: "WhatsApp is not fully configured." };
  const res = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(id)}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: message } }), signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, error: `WhatsApp responded ${res.status}: ${text.slice(0, 160)}` };
  let providerId: string | undefined;
  try { providerId = (JSON.parse(text) as { messages?: { id?: string }[] }).messages?.[0]?.id; } catch { /* ignore */ }
  return { ok: true, status: res.status, providerId };
}

const backoffMs = (attempt: number) => Math.min(30_000 * 2 ** (attempt - 1), 30 * 60_000);
let running = false;

/** Sends due messages. Failed ones retry with exponential backoff (30s, 1m, 2m… up to 30m) and become "dead" after max attempts. */
export async function processOutbox(db: Database.Database = getDb()): Promise<{ sent: number; failed: number; dead: number }> {
  if (running) return { sent: 0, failed: 0, dead: 0 };
  running = true;
  const out = { sent: 0, failed: 0, dead: 0 };
  try {
    const due = db.prepare("SELECT * FROM outbox WHERE status IN ('queued','retrying') AND next_attempt_at <= ? ORDER BY created_at LIMIT 20").all(nowIso()) as {
      id: string; channel: Channel; message: string; attempts: number; max_attempts: number;
    }[];
    for (const job of due) {
      let r: Sent;
      try { r = job.channel === "slack" ? await sendSlack(job.message) : await sendWhatsApp(job.message); }
      catch (e) { r = { ok: false, error: e instanceof Error ? e.message : "Network error" }; }
      const attempts = job.attempts + 1;
      if (r.ok) {
        db.prepare("UPDATE outbox SET status='sent', attempts=?, provider_id=?, last_error=NULL, updated_at=? WHERE id=?").run(attempts, r.providerId ?? null, nowIso(), job.id);
        out.sent++;
      } else if (attempts >= job.max_attempts) {
        db.prepare("UPDATE outbox SET status='dead', attempts=?, last_error=?, updated_at=? WHERE id=?").run(attempts, r.error ?? "failed", nowIso(), job.id);
        out.dead++;
      } else {
        db.prepare("UPDATE outbox SET status='retrying', attempts=?, last_error=?, next_attempt_at=?, updated_at=? WHERE id=?")
          .run(attempts, r.error ?? "failed", new Date(Date.now() + backoffMs(attempts)).toISOString(), nowIso(), job.id);
        out.failed++;
      }
    }
  } finally {
    running = false;
  }
  return out;
}
