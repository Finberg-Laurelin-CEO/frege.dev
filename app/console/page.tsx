import type { Metadata } from "next";
import { requireUserPageSession } from "@/lib/core/page-auth";
import PrototypeConsole from "../prototype/PrototypeConsole";

export const metadata: Metadata = {
  title: "Frege Knowledge Console",
  description: "A password-protected Frege console for permission-aware agent memory.",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function ConsolePage({ searchParams }: { searchParams?: Promise<{ view?: string; verified?: string }> }) {
  const session = await requireUserPageSession("/console");
  const params = await searchParams;
  return (
    <PrototypeConsole
      userEmail={session.user.email}
      emailVerifiedAt={session.user.email_verified_at ? String(session.user.email_verified_at) : null}
      memberships={session.memberships}
      initialView={params?.view}
      verificationStatus={params?.verified}
    />
  );
}
