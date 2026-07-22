import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSql } from "@/lib/db";
import { requireUserPageSession } from "@/lib/core/page-auth";
import { LIVE_RUN_ROOMS_ENABLED } from "@/lib/core/run-rooms";
import RunRoom from "./RunRoom";

export const metadata: Metadata = {
  title: "Run Room — Frege",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SessionRow = {
  id: string;
  org_id: string;
  title: string;
  client: string;
  status: string;
  live_status: string;
  controller_user_id: string | null;
  bridge_last_seen_at: Date | string | null;
  started_at: Date | string;
};

type MemberRow = {
  id: string;
  name: string;
  email: string;
};

export default async function RunRoomPage({ params }: { params: Promise<{ sessionId: string }> }) {
  if (!LIVE_RUN_ROOMS_ENABLED()) notFound();

  const { sessionId } = await params;
  if (!UUID_RE.test(sessionId)) notFound();

  const session = await requireUserPageSession(`/console/run-rooms/${sessionId}`);

  const sql = getSql();
  const [room] = (await sql`
    select id, org_id, title, client, status, live_status, controller_user_id, bridge_last_seen_at, started_at
    from brain_sessions
    where id = ${sessionId}
    limit 1
  `) as SessionRow[];

  // Out-of-org (or absent) is indistinguishable from not found — same shape as
  // the brain API denial path.
  if (!room) notFound();
  const membership = session.memberships.find((m) => m.org_id === room.org_id && m.status === "active");
  if (!membership) notFound();

  const members = (await sql`
    select users.id, users.name, users.email
    from organization_memberships
    join users on users.id = organization_memberships.user_id
    where organization_memberships.org_id = ${room.org_id}
      and organization_memberships.status = 'active'
    order by users.name asc, users.email asc
  `) as MemberRow[];

  return (
    <RunRoom
      sessionId={room.id}
      viewerId={session.user.id}
      orgName={membership.org_name}
      initialTitle={room.title}
      initialClient={room.client}
      initialLiveStatus={room.live_status}
      initialControllerId={room.controller_user_id}
      members={members.map((m) => ({ id: m.id, name: m.name || m.email, email: m.email }))}
    />
  );
}
