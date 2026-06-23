import type { Metadata } from "next";
import { requireUserPageSession } from "@/lib/prototype/page-auth";
import BillingPanel from "./BillingPanel";

export const metadata: Metadata = {
  title: "Frege Billing",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await requireUserPageSession("/billing");
  return <BillingPanel memberships={session.memberships} />;
}
