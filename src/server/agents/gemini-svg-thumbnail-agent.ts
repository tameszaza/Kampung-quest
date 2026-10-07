import OpenAI from "openai";
import type { QuestImageInput, QuestImageAgent, QuestImageResult } from "@/server/agents/quest-image-agent";
import { buildQuestImagePrompt } from "@/server/agents/quest-image-prompt";
import { logger, safeErrorMessage } from "@/server/observability/logger";
import { findAiControlError } from "@/server/security/ai-policy";

const MAX_SVG_BYTES = 120_000;

export interface GeminiSvgThumbnailAgentOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/**
 * Uses the normal Gemini text model to produce a small, self-contained SVG.
 * This is deliberately separate from Gemini's image models: the text model
 * has a different quota and can be rendered locally by Sharp.
 */
export class GeminiSvgThumbnailAgent implements QuestImageAgent {
  private readonly client: OpenAI;
  private readonly timeoutMs: number;

  constructor(private readonly options: GeminiSvgThumbnailAgentOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      fetch: options.fetch,
      maxRetries: 0,
      timeout: options.timeoutMs ?? 15_000,
    });
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async generate({ quest, variationKey }: QuestImageInput): Promise<QuestImageResult | null> {
    const startedAt = Date.now();
    logger.info("quest_image.gemini_svg.start", { model: this.options.model });
    try {
      const response = await this.client.chat.completions.create({
        model: this.options.model,
        temperature: 0.8,
        max_tokens: 3_000,
        messages: [{
          role: "user",
          content: [
            "Create a single self-contained SVG illustration for a Senior Quest activity thumbnail.",
            "Return ONLY the SVG XML, with no Markdown fences, explanation, or text labels.",
            "Use exactly width=1024 height=576 viewBox=\"0 0 1024 576\" and a 16:9 composition.",
            "Show a warm, dignified, high-contrast illustration of older adults enjoying the activity.",
            "Use only safe SVG primitives: svg, defs, linearGradient, radialGradient, stop, rect, circle, ellipse, path, line, polyline, polygon, g.",
            "Do not use scripts, foreignObject, image tags, external URLs, data URLs, filters, animations, embedded fonts, watermarks, logos, or personal information.",
            "Do not include any readable words or letters. Keep the SVG under 100 KB.",
            `Quest visual direction:\n${buildQuestImagePrompt(quest, variationKey)}`,
          ].join("\n"),
        }],
      }, { timeout: this.timeoutMs });
      const content = response.choices[0]?.message?.content;
      const sanitized = sanitizeSvg(typeof content === "string" ? content : "");
      if (!sanitized.svg) {
        logger.warn("quest_image.gemini_svg.invalid_response", {
          reason: sanitized.reason,
          contentType: typeof content,
          contentLength: typeof content === "string" ? content.length : 0,
          finishReason: response.choices[0]?.finish_reason ?? null,
        });
        return null;
      }
      logger.info("quest_image.gemini_svg.success", {
        bytes: Buffer.byteLength(sanitized.svg),
        elapsedMs: Date.now() - startedAt,
      });
      return { bytes: Buffer.from(sanitized.svg), mimeType: "image/svg+xml", model: this.options.model };
    } catch (error) {
      const admissionError = findAiControlError(error);
      if (admissionError) throw admissionError;
      const providerError = error as {
        status?: unknown;
        code?: unknown;
        type?: unknown;
        request_id?: unknown;
      };
      logger.warn("quest_image.gemini_svg.error", {
        error: safeErrorMessage(error),
        status: typeof providerError.status === "number" ? providerError.status : null,
        code: typeof providerError.code === "string" ? providerError.code : null,
        type: typeof providerError.type === "string" ? providerError.type : null,
        requestId: typeof providerError.request_id === "string" ? providerError.request_id : null,
        elapsedMs: Date.now() - startedAt,
      });
      return null;
    }
  }
}

function sanitizeSvg(raw: string): { svg: string | null; reason: string } {
  const match = raw.match(/<svg\b[\s\S]*?<\/svg>/i);
  if (!match) return { svg: null, reason: "missing_svg_root" };
  // Text is removed rather than rendered so a model cannot turn a thumbnail
  // into an unexpected label or expose prompt content.
  const svg = match[0]
    .replace(/<text\b[\s\S]*?<\/text>/gi, "")
    .replace(/<tspan\b[\s\S]*?<\/tspan>/gi, "")
    .replace(/<text\b[^>]*\/>/gi, "")
    .trim();
  if (Buffer.byteLength(svg) > MAX_SVG_BYTES) return { svg: null, reason: "svg_too_large" };
  if (!/<svg\b[^>]*\bwidth=["']1024["']/i.test(svg)
    || !/<svg\b[^>]*\bheight=["']576["']/i.test(svg)
    || !/<svg\b[^>]*\bviewBox=["']0 0 1024 576["']/i.test(svg)) return { svg: null, reason: "invalid_canvas" };
  if (/<(?:script|foreignObject|image|iframe|object|embed|video|audio|animate|set)\b|\b(?:href|xlink:href)\s*=|\bon[a-z]+\s*=|(?:javascript:|data:)|url\s*\(\s*(?:https?:|data:|javascript:)/i.test(svg)) {
    return { svg: null, reason: "unsafe_svg_content" };
  }
  return { svg, reason: "ok" };
}
