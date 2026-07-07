import type { Metadata } from "next";
import ResetPasswordPanel from "./ResetPasswordPanel";

export const metadata: Metadata = {
  title: "Reset Frege Password",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  return <ResetPasswordPanel initialToken={params?.token ?? ""} />;
}
