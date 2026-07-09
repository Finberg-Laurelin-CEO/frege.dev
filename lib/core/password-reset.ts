import { createHash, randomBytes } from "node:crypto";
import { customerAppBaseUrl } from "@/lib/core/public-url";

export const PASSWORD_RESET_EXPIRES_SECONDS = 60 * 60;

export function generatePasswordResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPasswordResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function passwordResetExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + PASSWORD_RESET_EXPIRES_SECONDS * 1000);
}

export function passwordResetUrl(rawToken: string): string {
  const url = new URL("/reset-password", customerAppBaseUrl());
  url.searchParams.set("token", rawToken);
  return url.toString();
}
