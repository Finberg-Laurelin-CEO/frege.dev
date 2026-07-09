import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyMaterial(): Buffer {
  const secret = process.env.FREGE_SECRET_KEY;
  if (!secret) {
    throw new Error("FREGE_SECRET_KEY is not set.");
  }

  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;

  const [version, rawIv, rawTag, rawCiphertext] = value.split(".");
  if (version !== "v1" || !rawIv || !rawTag || !rawCiphertext) {
    throw new Error("Invalid encrypted secret format.");
  }

  const decipher = createDecipheriv("aes-256-gcm", keyMaterial(), Buffer.from(rawIv, "base64url"));
  decipher.setAuthTag(Buffer.from(rawTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(rawCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
