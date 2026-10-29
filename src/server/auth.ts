import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getDb } from "./db";
import { SESSION_COOKIE, verifySessionToken } from "./session-token";

export const CLIENT_COOKIE = "complyra_client";

export type Role = "admin" | "reviewer" | "viewer";
export type SessionUser = { id: string; email: string; name: string; role: Role };

const scryptAsync = promisify(scrypt) as (
  password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// ---------- passwords (scrypt, parameters stored with the hash) ----------

const N = 2 ** 16, R = 8, P = 2, KEYLEN = 64, MAXMEM = 256 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: +n, r: +r, p: +p, maxmem: MAXMEM,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Verified against when the email is unknown, so response time does not reveal which emails exist. */
let dummyHash: Promise<string> | null = null;
export function dummyVerify(password: string): Promise<boolean> {
  dummyHash ??= hashPassword("not-a-real-password");
  return dummyHash.then((h) => verifyPassword(password, h));
}

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "Include both letters and numbers.";
  return null;
}

export { SESSION_COOKIE, SESSION_TTL_MS, signSession, verifySessionToken } from "./session-token";

// ---------- request helpers ----------

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function serializeCookie(
  name: string, value: string,
  o: { maxAgeSec?: number; secure: boolean; httpOnly?: boolean },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (o.httpOnly !== false) parts.push("HttpOnly");
  if (o.secure) parts.push("Secure");
  if (o.maxAgeSec !== undefined) parts.push(`Max-Age=${o.maxAgeSec}`);
  return parts.join("; ");
}

export function isSecureRequest(req: Request): boolean {
  return new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}

/** Resolves the signed session to a *current* DB user. Role and active flag come from the DB, never from the cookie. */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const session = verifySessionToken(readCookie(req, SESSION_COOKIE));
  if (!session) return null;
  const row = await getDb()
    .prepare("SELECT id, email, name, role, active FROM users WHERE id = ?")
    .get(session.uid) as (SessionUser & { active: number }) | undefined;
  if (!row || !row.active) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export function clientIp(req: Request): string {
  if (process.env.TRUST_PROXY === "1") {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }
  return "";
}
