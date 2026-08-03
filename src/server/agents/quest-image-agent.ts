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

export interface GeminiQuestImageAgentOptions {
  apiKey: string;
  model: string;
  baseURL: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Small, best-effort image agent. It deliberately has no retry loop: a quest
 * must never fail just because image generation is unavailable or rate-limited.
 */
export class GeminiQuestImageAgent implements QuestImageAgent {
  private readonly request: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: GeminiQuestImageAgentOptions) {
    this.request = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async generate({ quest, variationKey }: QuestImageInput): Promise<QuestImageResult | null> {
    const prompt = buildQuestImagePrompt(quest, variationKey);
    const endpoint = `${this.options.baseURL.replace(/\/+$/, "")}/models/${encodeURIComponent(this.options.model)}:generateContent`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.request(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.options.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            // Nano Banana 2 Lite supports 1K output and the standard 16:9
            // landscape ratio used by quest thumbnails.
            imageConfig: { aspectRatio: "16:9", imageSize: "1K" },
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const declaredSize = Number(response.headers.get("content-length") ?? 0);
      if (declaredSize > MAX_GENERATED_IMAGE_BYTES) return null;
      const payload = await response.json() as GeminiImageResponse;
      const imagePart = payload.candidates
        ?.flatMap((candidate) => candidate.content?.parts ?? [])
        .find((part) => {
        const inlineData = part.inlineData ?? part.inline_data;
        if (!inlineData) return false;
        const mimeType = inlineData.mimeType ?? inlineData.mime_type ?? "";
        return mimeType.startsWith("image/") && Boolean(inlineData.data);
        });
      const inlineData = imagePart?.inlineData ?? imagePart?.inline_data;
      if (!inlineData?.data) return null;
      const mimeType = inlineData.mimeType ?? inlineData.mime_type ?? "image/png";
      if (!mimeType.startsWith("image/")) return null;
      const encoded = inlineData.data.replace(/^data:[^;]+;base64,/, "");
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length === 0 || bytes.length > MAX_GENERATED_IMAGE_BYTES) return null;
      return {
        bytes,
        mimeType,
        model: this.options.model,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildQuestImagePrompt(quest: QuestProposal["quest"], variationKey = ""): string {
  const directions = [
    "Use a gentle sunlit garden gathering with a small handmade detail.",
    "Use a warm community-table scene with expressive hands and natural movement.",
    "Use a calm neighbourhood outdoor scene with a distinctive seasonal colour accent.",
    "Use a cosy indoor workshop scene with clear, friendly visual storytelling.",
    "Use a playful but dignified intergenerational moment with an unexpected viewpoint.",
  ];
  const direction = directions[hashText(`${quest.title}:${quest.sharedGoal}:${variationKey}`) % directions.length];
  return [
    "Create one original 16:9 editorial illustration for a community activity thumbnail.",
    "Show respectful, diverse older adults enjoying a safe, welcoming activity together.",
    direction,
    "Make the composition visually distinct and specific to this quest, not generic stock photography.",
    "Use warm natural light, high contrast, uncluttered shapes, and an optimistic Senior Quest feel.",
    "Do not include text, lettering, logos, UI, watermarks, personal data, or medical imagery.",
    `Activity title: ${limitText(quest.title, 120)}`,
    `Shared goal: ${limitText(quest.sharedGoal, 180)}`,
    `Description: ${limitText(quest.description, 280)}`,
  ].join("\n");
}

function limitText(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f]/g, " ").slice(0, max).trim();
}

function hashText(value: string): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return hash;
}

interface GeminiImageResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { mimeType?: string; mime_type?: string; data?: string };
        inline_data?: { mimeType?: string; mime_type?: string; data?: string };
      }>;
    };
  }>;
}
