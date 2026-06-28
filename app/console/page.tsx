import type { Metadata } from "next";
import { requireUserPageSession } from "@/lib/prototype/page-auth";
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

export default async function ConsolePage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const session = await requireUserPageSession("/console");
  const params = await searchParams;
  return <PrototypeConsole userEmail={session.user.email} memberships={session.memberships} initialView={params?.view} />;
}
