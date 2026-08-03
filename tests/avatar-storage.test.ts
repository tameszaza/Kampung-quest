import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { avatarKey, deleteAvatar, saveUploadedAvatar } from "@/server/profile/avatar-storage";

let directory = "";

describe("optimized avatar storage", () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "senior-quest-avatars-"));
    process.env.AVATAR_STORAGE_DIR = directory;
  });

  afterAll(async () => {
    delete process.env.AVATAR_STORAGE_DIR;
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("converts uploads to a bounded metadata-free WebP file", async () => {
    const source = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#25a474" } })
      .jpeg({ quality: 95 })
      .toBuffer();
    const file = new File([source], "portrait.jpg", { type: "image/jpeg" });
    const userId = "avatar-test-user";
    const url = await saveUploadedAvatar(userId, file);
    const stored = await readFile(join(directory, `${avatarKey(userId)}.webp`));
    const metadata = await sharp(stored).metadata();

    expect(url).toMatch(/^\/api\/profile\/avatar\/[a-f0-9]{32}\?v=\d+$/);
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBeLessThanOrEqual(512);
    expect(metadata.height).toBeLessThanOrEqual(512);
    expect(stored.byteLength).toBeLessThan(source.byteLength);

    await deleteAvatar(userId);
    await expect(readFile(join(directory, `${avatarKey(userId)}.webp`))).rejects.toThrow();
  });
});
