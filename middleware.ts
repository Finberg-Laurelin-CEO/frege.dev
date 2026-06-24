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

// Admin mode is on when the deploy is flagged admin-only (the frege-admin Vercel
// project sets FREGE_ADMIN_ONLY=true) OR the request arrives on the admin
// subdomain (admin.frege.dev). The hostname check lets a single deploy behave as
// the operations console for admin.* traffic even before the env flag is set.
function isAdminOnly(req: NextRequest): boolean {
  if (process.env.FREGE_ADMIN_ONLY === "true") return true;
  const host = req.headers.get("host") ?? req.nextUrl.host;
  return host.startsWith("admin.");
}

function isAllowedOnAdmin(pathname: string): boolean {
  if (pathname === "/") return false;
  return ADMIN_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function middleware(req: NextRequest) {
  if (!isAdminOnly(req)) {
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
