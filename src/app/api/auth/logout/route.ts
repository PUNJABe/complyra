import { getSessionUser, isSecureRequest, serializeCookie, SESSION_COOKIE } from "@/server/auth";
import { audit } from "@/server/audit";
import { route } from "@/server/http";

export const POST = route({ public: true }, ({ req, ip }) => {
  const user = getSessionUser(req);
  if (user) audit({ actor: user.email, action: "logout", resource: "auth", ip, details: "Signed out." });
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", serializeCookie(SESSION_COOKIE, "", { maxAgeSec: 0, secure: isSecureRequest(req) }));
  return res;
});
