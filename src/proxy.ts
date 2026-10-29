import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/server/session-token";

/**
 * Deny-by-default gate in front of every page and API route (Next 16 "proxy", formerly middleware).
 * It checks the *signature and expiry* of the session cookie. Every API handler still re-checks the user,
 * their role and their active flag against the database — this is the safety net, not the only lock.
 */
const PUBLIC_PAGES = new Set(["/login", "/setup"]);
const PUBLIC_API = new Set(["/api/setup", "/api/auth/login", "/api/auth/logout"]);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const signedIn = Boolean(verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value));

  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API.has(pathname) || signedIn) return NextResponse.next();
    return NextResponse.json({ error: "Sign in required.", code: "unauthenticated" }, { status: 401 });
  }

  if (PUBLIC_PAGES.has(pathname)) {
    if (signedIn && pathname === "/login") return NextResponse.redirect(new URL("/dashboard", req.url));
    return NextResponse.next();
  }
  if (pathname === "/") return NextResponse.next();
  if (!signedIn) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"] };
