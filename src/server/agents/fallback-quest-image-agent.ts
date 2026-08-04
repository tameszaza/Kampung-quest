import type { QuestImageInput, QuestImageAgent, QuestImageResult } from "@/server/agents/quest-image-agent";
import { logger, safeErrorMessage } from "@/server/observability/logger";

export interface QuestImageAgentCandidate {
  name: string;
  agent: QuestImageAgent;
}

/** Tries configured remote providers in order, then a guaranteed local agent. */
export class FallbackQuestImageAgent implements QuestImageAgent {
  constructor(private readonly candidates: QuestImageAgentCandidate[]) {}

  async generate(input: QuestImageInput): Promise<QuestImageResult | null> {
    for (const candidate of this.candidates) {
      try {
        const result = await candidate.agent.generate(input);
        if (result) {
          logger.info("quest_image.provider.selected", { provider: candidate.name, model: result.model });
          return result;
        }
        logger.warn("quest_image.provider.empty", { provider: candidate.name });
      } catch (error) {
        logger.warn("quest_image.provider.error", { provider: candidate.name, error: safeErrorMessage(error) });
      }
    }
    logger.error("quest_image.provider.exhausted", { providers: this.candidates.map(({ name }) => name).join(",") });
    return null;
  }
}
