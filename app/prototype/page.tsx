import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUserPageSession } from "@/lib/core/page-auth";

export const metadata: Metadata = {
  title: "Frege Knowledge Console",
  description: "A password-protected Frege console for permission-aware agent memory.",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function PrototypeRedirectPage() {
  await requireUserPageSession("/prototype");
  redirect("/console");
}
