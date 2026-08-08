import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { isProductionRuntime } from "@/server/runtime-environment";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE = 512;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function storageDirectory() {
  if (process.env.AVATAR_STORAGE_DIR) return process.env.AVATAR_STORAGE_DIR;
  if (isProductionRuntime()) throw new Error("AVATAR_STORAGE_DIR is required in production");
  return join(process.cwd(), ".data", "avatars");
}

export function avatarKey(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 32);
}

function avatarPath(key: string): string {
  if (!/^[a-f0-9]{32}$/.test(key)) throw new Error("Avatar not found");
  return join(storageDirectory(), `${key}.webp`);
}

export async function saveUploadedAvatar(userId: string, file: File): Promise<string> {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error("Use a JPG, PNG, or WebP photo");
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) throw new Error("Choose a photo smaller than 5 MB");
  return saveAvatarBuffer(userId, Buffer.from(await file.arrayBuffer()));
}

export async function importProviderAvatar(userId: string, source: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !isTrustedGoogleImageHost(url.hostname)) return null;
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(6_000),
    headers: { accept: "image/avif,image/webp,image/jpeg,image/png" },
  });
  if (!response.ok || !response.body) return null;
  const finalUrl = new URL(response.url);
  if (!isTrustedGoogleImageHost(finalUrl.hostname)) return null;
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_UPLOAD_BYTES) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_UPLOAD_BYTES) return null;
  return saveAvatarBuffer(userId, buffer);
}

export async function readAvatar(key: string): Promise<Buffer> {
  return readFile(avatarPath(key));
}

export async function deleteAvatar(userId: string): Promise<void> {
  try {
    await unlink(avatarPath(avatarKey(userId)));
  } catch (error) {
    if (!isFileMissing(error)) throw error;
  }
}

async function saveAvatarBuffer(userId: string, input: Buffer): Promise<string> {
  const optimized = await sharp(input, { limitInputPixels: 25_000_000 })
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, {
      fit: "cover",
      position: "attention",
      withoutEnlargement: true,
    })
    .webp({ quality: 78, effort: 4 })
    .toBuffer();
  const key = avatarKey(userId);
  await mkdir(storageDirectory(), { recursive: true });
  await writeFile(avatarPath(key), optimized, { mode: 0o600 });
  return `/api/profile/avatar/${key}?v=${Date.now()}`;
}

function isTrustedGoogleImageHost(hostname: string): boolean {
  return hostname === "lh3.googleusercontent.com" || hostname.endsWith(".googleusercontent.com");
}

function isFileMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
