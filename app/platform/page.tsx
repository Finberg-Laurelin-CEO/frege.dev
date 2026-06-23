import type { Metadata } from "next";
import { requirePlatformStaffPage } from "@/lib/prototype/page-auth";
import PlatformConsole from "./PlatformConsole";

export const metadata: Metadata = {
  title: "Frege Platform",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const session = await requirePlatformStaffPage("/platform");
  return <PlatformConsole staffEmail={session.user.email} />;
}
