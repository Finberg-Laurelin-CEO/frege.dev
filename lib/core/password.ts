import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SCRYPT_PARAMS = {
  keyLength: KEY_LENGTH,
  saltBytes: 16,
};

export type PasswordHashResult = {
  passwordHash: string;
  passwordSalt: string;
  passwordParams: {
    algorithm: "scrypt";
    key_length: number;
  };
};

export async function hashPassword(password: string, salt = randomBytes(SCRYPT_PARAMS.saltBytes).toString("hex")): Promise<PasswordHashResult> {
  const derived = (await scrypt(password, salt, SCRYPT_PARAMS.keyLength)) as Buffer;

  return {
    passwordHash: derived.toString("hex"),
    passwordSalt: salt,
    passwordParams: {
      algorithm: "scrypt",
      key_length: SCRYPT_PARAMS.keyLength,
    },
  };
}

export async function verifyPassword(password: string, salt: string, storedHash: string): Promise<boolean> {
  const candidate = Buffer.from((await hashPassword(password, salt)).passwordHash, "hex");
  const stored = Buffer.from(storedHash, "hex");

  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}
