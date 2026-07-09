import type { Metadata } from "next";
import { requireUserPageSession } from "@/lib/core/page-auth";
import SupportConsole from "./SupportConsole";

export const metadata: Metadata = {
  title: "Frege Support",
  description: "Raise and track support tickets for your organization.",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const session = await requireUserPageSession("/support");
  return <SupportConsole userEmail={session.user.email} memberships={session.memberships} />;
}
