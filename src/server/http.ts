import { ZodError } from "zod";
import { CLIENT_COOKIE, clientIp, getSessionUser, readCookie, type Role, type SessionUser } from "./auth";
import { getDb } from "./db";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export type Ctx = {
  req: Request;
  user: SessionUser;
  clientId: string;
  params: Record<string, string>;
  ip: string;
};

type Options = {
  /** Allowed roles. Omit for any signed-in user. */
  roles?: Role[];
  /** Skips authentication entirely (login, setup status). */
  public?: boolean;
  /** Handler does not need an active client (clients list, users, session). */
  noClient?: boolean;
};

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** CSRF defence in depth on top of SameSite=Lax: unsafe requests must come from our own origin. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (curl, scripts) send no Origin
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function activeClientId(req: Request): string | null {
  const db = getDb();
  const wanted = readCookie(req, CLIENT_COOKIE);
  if (wanted) {
    const hit = db.prepare("SELECT id FROM clients WHERE id = ?").get(wanted) as { id: string } | undefined;
    if (hit) return hit.id;
  }
  const first = db.prepare("SELECT id FROM clients ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
  return first?.id ?? null;
}

export function route(opts: Options, handler: (ctx: Ctx) => Promise<unknown> | unknown) {
  return async (req: Request, routeCtx?: { params?: Promise<Record<string, string>> }): Promise<Response> => {
    try {
      if (!SAFE.has(req.method) && !sameOrigin(req)) throw new HttpError(403, "Cross-origin request blocked.");

      let user: SessionUser | null = null;
      if (!opts.public) {
        user = getSessionUser(req);
        if (!user) throw new HttpError(401, "Sign in required.", "unauthenticated");
        if (opts.roles && !opts.roles.includes(user.role)) {
          throw new HttpError(403, "Your role does not allow this action.", "forbidden");
        }
      }

      let clientId = "";
      if (!opts.noClient && !opts.public) {
        const id = activeClientId(req);
        if (!id) throw new HttpError(409, "Create a client first.", "no_client");
        clientId = id;
      }

      const params = routeCtx?.params ? await routeCtx.params : {};
      const result = await handler({ req, user: user as SessionUser, clientId, params, ip: clientIp(req) });
      if (result instanceof Response) return result;
      return Response.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      if (err instanceof HttpError) {
        return Response.json({ error: err.message, code: err.code }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return Response.json(
          { error: "Please check the highlighted fields.", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
          { status: 400 },
        );
      }
      console.error("[api error]", req.method, new URL(req.url).pathname, err);
      return Response.json({ error: "Something went wrong on the server." }, { status: 500 });
    }
  };
}

export async function jsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

export const WRITE: Role[] = ["admin", "reviewer"];
export const ADMIN: Role[] = ["admin"];
