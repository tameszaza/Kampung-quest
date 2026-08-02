import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
const KEY_LENGTH = 64;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelism, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !cost || !blockSize || !parallelism || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const derived = await deriveKey(password, Buffer.from(saltValue, "base64url"), expected.length, {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelism),
    maxmem: 64 * 1024 * 1024,
  });
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function deriveKey(
  password: string,
  salt: Buffer,
  length: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
