import type { Metadata } from "next";
import SetupPanel from "./SetupPanel";

export const metadata: Metadata = {
  title: "Frege Setup",
  robots: {
    index: false,
    follow: false,
  },
};

export default function SetupPage() {
  return <SetupPanel />;
}
