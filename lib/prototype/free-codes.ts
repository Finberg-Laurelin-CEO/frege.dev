import { createHash, randomBytes } from "node:crypto";

const CODE_PREFIX = "FRG-COMP";

export function normalizeFreeActivationCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashFreeActivationCode(code: string): string {
  return createHash("sha256").update(normalizeFreeActivationCode(code)).digest("hex");
}

function randomCodeSegment(): string {
  let segment = "";
  while (segment.length < 6) {
    segment += randomBytes(4).toString("base64url").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  }
  return segment.slice(0, 6);
}

export function generateFreeActivationCode(): string {
  return `${CODE_PREFIX}-${randomCodeSegment()}-${randomCodeSegment()}-${randomCodeSegment()}`;
}
