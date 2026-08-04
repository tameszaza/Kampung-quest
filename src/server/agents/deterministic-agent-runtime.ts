import type { AgentRuntime, MemoryAgentInput } from "@/server/agents/agent-runtime";
import type { MemoryAgentOutput } from "@/server/domain/schemas";
import { stableFactRef } from "@/server/agents/provider-privacy";
import { QuestSynthesisService } from "@/server/features/synthesis-service";
import { SafetyGuardianService } from "@/server/features/safety-service";

export class DeterministicAgentRuntime implements AgentRuntime {
  private readonly synthesis = new QuestSynthesisService();
  private readonly safety = new SafetyGuardianService();

  async conductConversation(
    input: Parameters<AgentRuntime["conductConversation"]>[0],
  ): ReturnType<AgentRuntime["conductConversation"]> {
    const requestedField = input.missingFields[0] ?? null;
    const prompts = {
      goal: "What would feel helpful or enjoyable for your next quest?",
      interests: "What interests would you like this quest to include?",
      offers: "Is there anything you would enjoy contributing?",
      availability: "When are you generally available? You can share several times or a weekly pattern; this will not schedule the activity yet.",
      group_size: "What group size would feel comfortable?",
      indoor: "Would you prefer an indoor setting?",
      stairs: "Are stairs comfortable for you?",
      distance: "How far would you be comfortable travelling?",
      language: "Which language should the group use?",
      consent: "May I use these details to look for suitable neighbours?",
    } as const;
    return {
      reply: requestedField ? prompts[requestedField] : "I have enough information to prepare your quest brief.",
      briefPatch: {},
      requestedField,
      suggestedReplies: [],
      status: requestedField ? "collecting" : "ready_for_review",
    };
  }

  async updateMemory(input: MemoryAgentInput): Promise<MemoryAgentOutput> {
    const { profile, narrative } = input;
    const previous = input.currentMemory?.profile;
    const need = input.providedSoftFacts?.need === false && previous ? previous.need : profile.need;
    const mergedInterests = input.providedSoftFacts?.interests === false && previous
      ? previous.interests
      : profile.interests;
    const mergedOffers = input.providedSoftFacts?.offers === false && previous
      ? previous.offers
      : profile.offers;
    const interests = mergedInterests.length > 0 ? mergedInterests : ["Not specified"];
    const offers = mergedOffers.length > 0 ? mergedOffers : ["Not specified"];

    return {
      need,
      interests: mergedInterests,
      offers: mergedOffers,
      markdown: [
        "---",
        `senior_id: ${profile.candidateId}`,
        `status: ${profile.memoryStatus}`,
        "---",
        "",
        "# Current need",
        "",
        need,
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
    return {
      outcome: "proposal",
      proposal: this.synthesis.synthesize(input.initiator, input.candidates),
      primaryIntentRef: stableFactRef("need", input.initiator.need),
    };
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

  async coordinateEvent(
    input: Parameters<AgentRuntime["coordinateEvent"]>[0],
  ): ReturnType<AgentRuntime["coordinateEvent"]> {
    const message = input.latestMessage.trim();
    const lower = message.toLowerCase();
    const requirementPatch: Awaited<ReturnType<AgentRuntime["coordinateEvent"]>>["requirementPatch"] = {};
    if (/cannot|can't|unavailable|conflict|not free/.test(lower)) requirementPatch.temporaryConflicts = [message];
    if (/wheelchair|stairs|step-free|accessible|walking aid/.test(lower)) requirementPatch.accessibility = [message];
    if (/halal|vegetarian|vegan|allerg|diet/.test(lower)) requirementPatch.dietary = [message];
    if (/travel|distance|bus|taxi|walk/.test(lower)) requirementPatch.travel = [message];
    if (/venue|community centre|community center|library|park/.test(lower)) requirementPatch.venuePreferences = [message];
    if (Object.keys(requirementPatch).length === 0) requirementPatch.other = [message];
    return {
      reply: "I have prepared that as a private coordination requirement. Please confirm it before I use it to arrange the quest.",
      requirementPatch,
    };
  }
}
