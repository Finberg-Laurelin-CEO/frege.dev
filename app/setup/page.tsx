import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSql } from "@/lib/db";
import SetupPanel from "./SetupPanel";

export const metadata: Metadata = {
  title: "Frege Setup",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

async function isBootstrapAvailable(): Promise<boolean> {
  if (!process.env.FREGE_BOOTSTRAP_TOKEN) return false;

  try {
    const sql = getSql();
    const [userCount] = await sql`select count(*)::int as count from users`;
    return Number((userCount as { count: number }).count) === 0;
  } catch {
    return false;
  }
}

export default async function SetupPage() {
  if (!(await isBootstrapAvailable())) redirect("/login");

  return <SetupPanel />;
}
