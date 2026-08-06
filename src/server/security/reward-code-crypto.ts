import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function encryptionKey(version = 1): Buffer {
  const raw = process.env[`REWARD_CODE_ENCRYPTION_KEY_V${version}`]?.trim()
    ?? (version === 1 ? process.env.REWARD_CODE_ENCRYPTION_KEY?.trim() : undefined);
  if (!raw) throw new Error("REWARD_CODE_ENCRYPTION_KEY is required to read reward codes");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("REWARD_CODE_ENCRYPTION_KEY must be a 32-byte hex or base64 value");
  return key;
}

export function encryptRewardCode(code: string, version = 1): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(version), iv);
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptRewardCode(value: Buffer | Uint8Array, version = 1): string {
  const payload = Buffer.from(value);
  if (payload.length < IV_LENGTH + TAG_LENGTH) throw new Error("Reward code ciphertext is invalid");
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(version), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function fingerprintRewardCode(code: string): string {
  const secret = process.env.REWARD_CODE_FINGERPRINT_KEY?.trim()
    ?? process.env.REWARD_CODE_ENCRYPTION_KEY?.trim();
  if (!secret) throw new Error("REWARD_CODE_FINGERPRINT_KEY is required to import reward codes");
  return createHmac("sha256", secret).update(code).digest("hex");
}
