import { NextResponse, type NextRequest } from "next/server";
import { auth0, isAuth0AdminMode } from "@/lib/prototype/auth0";

// When deployed as the dedicated admin project (frege-admin), this instance is an
// operations console only — not the public marketing site. We set FREGE_ADMIN_ONLY=true
// on that Vercel project and redirect every non-admin surface to /platform.
//
// On the main site (flag unset) this middleware is a pass-through.

// Paths the admin-only deployment is allowed to serve. Everything else → /platform.
const ADMIN_ALLOWED_PREFIXES = [
  "/platform",
  "/api",
  "/auth",
  "/login",
  "/admin",
  "/setup",
  "/invite",
];

function isAdminOnly(): boolean {
  return process.env.FREGE_ADMIN_ONLY === "true";
}

function isAllowedOnAdmin(pathname: string): boolean {
  if (pathname === "/") return false;
  return ADMIN_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function middleware(req: NextRequest) {
  if (!isAdminOnly()) {
    return NextResponse.next();
  }

  // Auth0 mounts and maintains /auth/* (login, logout, callback) and refreshes
  // the session. Let it handle its own routes; for other paths it returns a
  // pass-through response we continue from.
  if (isAuth0AdminMode() && auth0) {
    const { pathname } = req.nextUrl;
    if (pathname.startsWith("/auth")) {
      return auth0.middleware(req);
    }
    const authRes = await auth0.middleware(req);
    if (isAllowedOnAdmin(pathname)) {
      return authRes;
    }
    const url = req.nextUrl.clone();
    url.pathname = "/platform";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const { pathname } = req.nextUrl;
  if (isAllowedOnAdmin(pathname)) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/platform";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static asset files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
