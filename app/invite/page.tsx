import type { Metadata } from "next";
import InvitePanel from "./InvitePanel";

export const metadata: Metadata = {
  title: "Accept invite — Frege",
  robots: { index: false, follow: false },
};

export default function InvitePage() {
  return <InvitePanel />;
}
