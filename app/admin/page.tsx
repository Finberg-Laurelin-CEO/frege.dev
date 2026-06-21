import type { Metadata } from "next";
import { requireUserPageSession } from "@/lib/prototype/page-auth";
import AdminConsole from "./AdminConsole";

export const metadata: Metadata = {
  title: "Frege Admin",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireUserPageSession("/admin");
  return <AdminConsole />;
}
