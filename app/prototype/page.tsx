import type { Metadata } from "next";
import { requireUserPageSession } from "@/lib/prototype/page-auth";
import PrototypeConsole from "./PrototypeConsole";

export const metadata: Metadata = {
  title: "Frege Prototype Console",
  description: "A local Frege prototype console for permission-aware agent memory.",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function PrototypePage() {
  await requireUserPageSession("/prototype");
  return <PrototypeConsole />;
}
