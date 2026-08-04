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
  /** Minimum spacing between image requests made by this process. */
  minRequestIntervalMs?: number;
  /** Short, bounded retries for temporary 429 responses. */
  maxRetries?: number;
  maxRetryDelayMs?: number;
}

const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Small, best-effort image agent. Image generation is retried only for a
 * short, temporary rate limit; a daily/account quota is returned immediately
 * so a quest never waits for a request that cannot succeed.
 */
export class GeminiQuestImageAgent implements QuestImageAgent {
  private readonly request: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly minRequestIntervalMs: number;
  private readonly maxRetries: number;
  private readonly maxRetryDelayMs: number;

  constructor(private readonly options: GeminiQuestImageAgentOptions) {
    this.request = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.minRequestIntervalMs = options.minRequestIntervalMs ?? 1_000;
    this.maxRetries = options.maxRetries ?? 1;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 10_000;
  }

  async generate({ quest, variationKey }: QuestImageInput): Promise<QuestImageResult | null> {
    const prompt = buildQuestImagePrompt(quest, variationKey);
    const endpoint = `${this.options.baseURL.replace(/\/+$/, "")}/models/${encodeURIComponent(this.options.model)}:generateContent`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        await waitForRequestSlot(this.minRequestIntervalMs);
        const result = await this.requestOnce(endpoint, prompt, controller);
        if (result.kind === "retry") {
          if (attempt >= this.maxRetries || result.delayMs > this.maxRetryDelayMs) return null;
          await delay(result.delayMs);
          continue;
        }
        return result.value;
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestOnce(
    endpoint: string,
    prompt: string,
    controller: AbortController,
  ): Promise<{ kind: "value"; value: QuestImageResult | null } | { kind: "retry"; delayMs: number }> {
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
          imageConfig: { aspectRatio: "16:9", imageSize: "1K" },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status !== 429) return { kind: "value", value: null };
      const body = await response.text().catch(() => "");
      if (/daily|per day|quota exhausted|limit: 0/i.test(body)) return { kind: "value", value: null };
      return { kind: "retry", delayMs: retryDelayMs(response.headers.get("retry-after"), body) };
    }
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_GENERATED_IMAGE_BYTES) return { kind: "value", value: null };
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
    if (!inlineData?.data) return { kind: "value", value: null };
    const mimeType = inlineData.mimeType ?? inlineData.mime_type ?? "image/png";
    if (!mimeType.startsWith("image/")) return { kind: "value", value: null };
    const encoded = inlineData.data.replace(/^data:[^;]+;base64,/, "");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length === 0 || bytes.length > MAX_GENERATED_IMAGE_BYTES) return { kind: "value", value: null };
    return {
      kind: "value",
      value: { bytes, mimeType, model: this.options.model },
    };
  }
}

let nextImageRequestAt = 0;

async function waitForRequestSlot(minIntervalMs: number) {
  const now = Date.now();
  const waitMs = Math.max(0, nextImageRequestAt - now);
  nextImageRequestAt = Math.max(now, nextImageRequestAt) + Math.max(0, minIntervalMs);
  if (waitMs > 0) await delay(waitMs);
}

function retryDelayMs(retryAfter: string | null, body: string): number {
  const seconds = retryAfter ? Number.parseFloat(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1_000, seconds * 1_000);
  const match = body.match(/retry(?: after| in)?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*s/i);
  if (match) return Math.max(1_000, Number.parseFloat(match[1]) * 1_000);
  return 1_000;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
