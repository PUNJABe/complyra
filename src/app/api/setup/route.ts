import { z } from "zod";
import { CLIENT_COOKIE, isSecureRequest, passwordProblem, serializeCookie, SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/server/auth";
import { createWorkspace, hasUsers } from "@/server/bootstrap";
import { getDb } from "@/server/db";
import { HttpError, jsonBody, route } from "@/server/http";
import { hit } from "@/server/ratelimit";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email(),
  password: z.string().max(200),
  clientName: z.string().trim().min(2).max(120),
  gstin: z.string().trim().max(15).optional(),
  pan: z.string().trim().max(10).optional(),
});

export const GET = route({ public: true }, async () => ({ needsSetup: !(await hasUsers()), signupAvailable: true }));

export const POST = route({ public: true }, async ({ req, ip }) => {
  if (!hit(`setup:${ip}`, 10, 15 * 60_000).allowed) throw new HttpError(429, "Too many attempts. Try again later.");
  const body = schema.parse(await jsonBody(req));
  const problem = passwordProblem(body.password);
  if (problem) throw new HttpError(400, problem);
  const ids = await createWorkspace(getDb(), { ...body, ip });
  const secure = isSecureRequest(req);
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", serializeCookie(SESSION_COOKIE, signSession(ids.userId), { maxAgeSec: SESSION_TTL_MS / 1000, secure }));
  res.headers.append("Set-Cookie", serializeCookie(CLIENT_COOKIE, ids.clientId, { maxAgeSec: 31536000, secure, httpOnly: false }));
  return res;
});
