import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateSessionToken, SESSION_COOKIE, type UserSessionContext } from "@/lib/prototype/session";

function loginUrl(nextPath: string): string {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

export async function requireUserPageSession(nextPath: string): Promise<UserSessionContext> {
  const cookieStore = await cookies();
  const session = await authenticateSessionToken(cookieStore.get(SESSION_COOKIE)?.value ?? null);

  if (!session) redirect(loginUrl(nextPath));

  return session;
}
