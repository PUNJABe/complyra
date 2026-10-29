import { z } from "zod";
import { audit } from "@/server/audit";
import { dummyVerify, isSecureRequest, serializeCookie, SESSION_COOKIE, SESSION_TTL_MS, signSession, verifyPassword } from "@/server/auth";
import { getDb } from "@/server/db";
import { HttpError, jsonBody, route } from "@/server/http";
import { hit, reset } from "@/server/ratelimit";

const schema = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });

export const POST = route({ public: true }, async ({ req, ip }) => {
  const { email, password } = schema.parse(await jsonBody(req));
  const key = `login:${ip}:${email.toLowerCase()}`;
  const gate = hit(key, 5, 15 * 60_000);
  if (!gate.allowed || !hit(`login-ip:${ip}`, 40, 15 * 60_000).allowed) {
    throw new HttpError(429, `Too many sign-in attempts. Try again in ${Math.max(1, Math.ceil(gate.retryAfterSec / 60))} minutes.`);
  }
  const db = getDb();
  const user = await db.prepare("SELECT id, email, password_hash, active FROM users WHERE email = ?").get(email) as
    | { id: string; email: string; password_hash: string; active: number } | undefined;
  const ok = user ? await verifyPassword(password, user.password_hash) : await dummyVerify(password);
  if (!user || !ok || !user.active) {
    await audit({ actor: email.slice(0, 200), action: "login_failed", resource: "auth", severity: "warning", ip, details: "Failed sign-in attempt." }, db);
    throw new HttpError(401, "Email or password is incorrect.");
  }
  reset(key);
  await audit({ actor: user.email, action: "login_success", resource: "auth", ip, details: "Signed in." }, db);
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", serializeCookie(SESSION_COOKIE, signSession(user.id), { maxAgeSec: SESSION_TTL_MS / 1000, secure: isSecureRequest(req) }));
  return res;
});
