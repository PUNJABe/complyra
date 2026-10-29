import { z } from "zod";
import { CLIENT_COOKIE, isSecureRequest, serializeCookie } from "@/server/auth";
import { getDb } from "@/server/db";
import { HttpError, jsonBody, route } from "@/server/http";

export const POST = route({ noClient: true }, async ({ req }) => {
  const { clientId } = z.object({ clientId: z.string() }).parse(await jsonBody(req));
  if (!await getDb().prepare("SELECT 1 FROM clients WHERE id = ?").get(clientId)) throw new HttpError(404, "Client not found.");
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", serializeCookie(CLIENT_COOKIE, clientId, { maxAgeSec: 31536000, secure: isSecureRequest(req), httpOnly: false }));
  return res;
});
