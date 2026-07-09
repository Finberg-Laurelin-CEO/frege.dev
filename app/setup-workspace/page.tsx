import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUserPageSession } from "@/lib/core/page-auth";
import SetupWorkspacePanel from "./SetupWorkspacePanel";

export const metadata: Metadata = {
  title: "Set up your workspace — Frege",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

// Workspace setup for social signups: session-gated exactly like /console
// (same page-auth helper). Users who already belong to a workspace have
// nothing to do here and go straight to the console.
export default async function SetupWorkspacePage() {
  const session = await requireUserPageSession("/setup-workspace");
  if (session.memberships.some((membership) => membership.status === "active")) {
    redirect("/console");
  }

  return <SetupWorkspacePanel userEmail={session.user.email} />;
}
