import type { QuestImageInput, QuestImageAgent, QuestImageResult } from "@/server/agents/quest-image-agent";
import { logger, safeErrorMessage } from "@/server/observability/logger";
import { findAiControlError } from "@/server/security/ai-policy";

export interface RetryingQuestImageAgentOptions {
  maxAttempts?: number;
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

/**
 * Retries one provider without introducing another image provider or a stock
 * fallback. The caller can show a neutral placeholder while this runs.
 */
export class RetryingQuestImageAgent implements QuestImageAgent {
  private readonly maxAttempts: number;
  private readonly delayMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;

  constructor(
    private readonly agent: QuestImageAgent,
    options: RetryingQuestImageAgentOptions = {},
  ) {
    this.maxAttempts = Math.max(1, Math.min(5, Math.floor(options.maxAttempts ?? 3)));
    this.delayMs = Math.max(0, Math.floor(options.delayMs ?? 1_000));
    this.sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  }

  async generate(input: QuestImageInput): Promise<QuestImageResult | null> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const result = await this.agent.generate(input);
        if (result) {
          logger.info("quest_image.retry.success", { attempt, maxAttempts: this.maxAttempts, model: result.model });
          return result;
        }
        logger.warn("quest_image.retry.empty", { attempt, maxAttempts: this.maxAttempts });
      } catch (error) {
        if (findAiControlError(error)) return null;
        logger.warn("quest_image.retry.error", {
          attempt,
          maxAttempts: this.maxAttempts,
          error: safeErrorMessage(error),
        });
      }
      if (attempt < this.maxAttempts && this.delayMs > 0) await this.sleep(this.delayMs);
    }
    logger.error("quest_image.retry.exhausted", { attempts: this.maxAttempts });
    return null;
  }
}
