import type { QuestProposal } from "@/server/domain/schemas";

export interface QuestImageInput {
  quest: QuestProposal["quest"];
  /** Server-generated variation key; never contains member identity or contact data. */
  variationKey?: string;
}

export interface QuestImageResult {
  bytes: Buffer;
  mimeType: string;
  model: string;
}

export interface QuestImageAgent {
  generate(input: QuestImageInput): Promise<QuestImageResult | null>;
}
