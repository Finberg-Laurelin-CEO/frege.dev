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

// frege.dev is the public marketing site (explore + sign in). brain.frege.dev is
// the authenticated app where a user works with their account and org. These are
// the app surfaces that belong on brain.* — everything else (home, pricing,
// docs, etc.) is marketing and stays on frege.dev.
const APP_PREFIXES = ["/console", "/billing", "/admin", "/prototype"];

// Shared infra that must work on either host (auth handshake, API, invites).
const APP_SHARED_PREFIXES = ["/api", "/auth", "/login", "/invite", "/setup"];

const APP_HOST = "brain.frege.dev";
const MARKETING_HOST = "frege.dev";

function isBrainHost(req: NextRequest): boolean {
  const host = (req.headers.get("host") ?? req.nextUrl.host).split(":")[0]?.toLowerCase() ?? "";
  return host.startsWith("brain.");
}

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

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
  const { pathname: reqPath } = req.nextUrl;

  // brain.frege.dev: the authenticated app. Serve app + shared infra routes;
  // bounce marketing paths back to frege.dev. Root goes straight to the console.
  if (isBrainHost(req)) {
    if (reqPath === "/") {
      const url = req.nextUrl.clone();
      url.pathname = "/console";
      return NextResponse.redirect(url);
    }
    if (matchesPrefix(reqPath, APP_PREFIXES) || matchesPrefix(reqPath, APP_SHARED_PREFIXES)) {
      return NextResponse.next();
    }
    // Any non-app path on the app host belongs on the marketing site.
    return NextResponse.redirect(new URL(`https://${MARKETING_HOST}${reqPath}${req.nextUrl.search}`));
  }

  // frege.dev (or preview): keep the app surfaces on the app subdomain. Send
  // authenticated app routes to brain.frege.dev so the product lives there.
  // Skip this for preview deploys (*.vercel.app) and localhost where the app
  // subdomain does not exist.
  const host = (req.headers.get("host") ?? req.nextUrl.host).split(":")[0]?.toLowerCase() ?? "";
  if (host === MARKETING_HOST && matchesPrefix(reqPath, APP_PREFIXES)) {
    return NextResponse.redirect(new URL(`https://${APP_HOST}${reqPath}${req.nextUrl.search}`));
  }

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
