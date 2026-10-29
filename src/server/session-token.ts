import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

export const SESSION_COOKIE = "complyra_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

let cachedSecret: Buffer | null = null;
function secret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
    return (cachedSecret = Buffer.from(fromEnv));
  }
  if (process.env.VERCEL || process.env.DATABASE_URL) {
    throw new Error("SESSION_SECRET must be configured when using a hosted database.");
  }
  // No env secret: create one once and keep it next to the database (mode 600).
  const file = path.join(dataDir(), ".session-secret");
  try {
    cachedSecret = Buffer.from(fs.readFileSync(file, "utf8").trim());
  } catch {
    fs.mkdirSync(dataDir(), { recursive: true });
    const fresh = randomBytes(48).toString("hex");
    fs.writeFileSync(file, fresh, { mode: 0o600 });
    cachedSecret = Buffer.from(fresh);
  }
  return cachedSecret;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signSession(userId: string, now = Date.now()): string {
  const body = b64u(JSON.stringify({ uid: userId, iat: now, exp: now + SESSION_TTL_MS }));
  return `${body}.${b64u(createHmac("sha256", secret()).update(body).digest())}`;
}

export function verifySessionToken(token: string | undefined | null, now = Date.now()): { uid: string } | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { uid?: string; exp?: number };
    return p.uid && p.exp && p.exp >= now ? { uid: p.uid } : null;
  } catch {
    return null;
  }
}
