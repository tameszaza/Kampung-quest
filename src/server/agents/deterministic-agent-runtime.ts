import type { AgentRuntime, MemoryAgentInput } from "@/server/agents/agent-runtime";
import type { MemoryAgentOutput } from "@/server/domain/schemas";
import { QuestSynthesisService } from "@/server/features/synthesis-service";
import { SafetyGuardianService } from "@/server/features/safety-service";

export class DeterministicAgentRuntime implements AgentRuntime {
  private readonly synthesis = new QuestSynthesisService();
  private readonly safety = new SafetyGuardianService();

  async updateMemory(input: MemoryAgentInput): Promise<MemoryAgentOutput> {
    const { profile, narrative } = input;
    const interests = profile.interests.length > 0 ? profile.interests : ["Not specified"];
    const offers = profile.offers.length > 0 ? profile.offers : ["Not specified"];

    return {
      need: profile.need,
      interests: profile.interests,
      offers: profile.offers,
      markdown: [
        "---",
        `senior_id: ${profile.candidateId}`,
        `status: ${profile.memoryStatus}`,
        "---",
        "",
        "# Current need",
        "",
        profile.need,
        "",
        "# Latest context",
        "",
        narrative,
        "",
        "# Interests",
        "",
        ...interests.map((item) => `- ${item}`),
        "",
        "# What the senior can contribute",
        "",
        ...offers.map((item) => `- ${item}`),
      ].join("\n"),
    };
  }

  async synthesizeQuest(
    input: Parameters<AgentRuntime["synthesizeQuest"]>[0],
  ): ReturnType<AgentRuntime["synthesizeQuest"]> {
    return this.synthesis.synthesize(input.initiator, input.candidates);
  }

  async reviewSafety(
    input: Parameters<AgentRuntime["reviewSafety"]>[0],
  ): ReturnType<AgentRuntime["reviewSafety"]> {
    return this.safety.review(input.proposal, input.profiles);
  }

  async recoverQuest(
    input: Parameters<AgentRuntime["recoverQuest"]>[0],
  ): ReturnType<AgentRuntime["recoverQuest"]> {
    return {
      replacementCandidateId: input.run.proposal?.reserveCandidates[0]?.candidateId ?? null,
    };
  }
}
