import type { Metadata } from "next";
import ForgotPasswordPanel from "./ForgotPasswordPanel";

export const metadata: Metadata = {
  title: "Forgot password — Frege",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordPanel />;
}
