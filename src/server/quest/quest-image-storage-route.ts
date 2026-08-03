import { createQuestImageStorage } from "@/server/quest/quest-image-storage";

/** Route-only read helper keeps filesystem access out of the client bundle. */
export function readQuestImage(key: string): Promise<Buffer> {
  return createQuestImageStorage().read(key);
}
