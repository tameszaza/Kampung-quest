import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { QuestImageResult } from "@/server/agents/quest-image-agent";
import { isProductionRuntime } from "@/server/runtime-environment";

const THUMBNAIL_WIDTH = 1200;
const THUMBNAIL_HEIGHT = 675;

export interface QuestImageStorage {
  save(result: QuestImageResult): Promise<string>;
  read(key: string): Promise<Buffer>;
}

export class LocalQuestImageStorage implements QuestImageStorage {
  constructor(private readonly directory = storageDirectory()) {}

  async save(result: QuestImageResult): Promise<string> {
    const optimized = await sharp(result.bytes, { limitInputPixels: 40_000_000 })
      .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, { fit: "cover", position: "attention" })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();
    const key = createHash("sha256").update(optimized).digest("hex").slice(0, 40);
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, `${key}.webp`), optimized, { mode: 0o600 });
    return `/api/quest-images/${key}`;
  }

  async read(key: string): Promise<Buffer> {
    if (!/^[a-f0-9]{40}$/.test(key)) throw new Error("Quest image not found");
    return readFile(join(this.directory, `${key}.webp`));
  }
}

function storageDirectory(): string {
  if (process.env.QUEST_IMAGE_STORAGE_DIR) return process.env.QUEST_IMAGE_STORAGE_DIR;
  if (isProductionRuntime()) throw new Error("QUEST_IMAGE_STORAGE_DIR is required in production");
  return join(process.cwd(), ".data", "quest-images");
}

export function createQuestImageStorage(): QuestImageStorage {
  return new LocalQuestImageStorage();
}
