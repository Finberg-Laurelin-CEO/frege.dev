import type { Metadata } from "next";
import LoginPanel from "./LoginPanel";

export const metadata: Metadata = {
  title: "Frege Login",
  robots: {
    index: false,
    follow: false,
  },
};

export default function LoginPage() {
  return <LoginPanel />;
}
