import { randomUUID } from "node:crypto";
import {
  Agent,
  Runner,
  setTracingDisabled,
  type AgentOutputType,
  type ModelProvider,
  type ModelRetrySettings,
} from "@openai/agents";
import type { AgentAuditSink, AgentRuntime, MemoryAgentInput } from "@/server/agents/agent-runtime";
import type { AgentProviderName, HostedModelConfiguration } from "@/server/agents/provider-configuration";
import { minimizeProviderInput, stableFactRef } from "@/server/agents/provider-privacy";
import {
  assistantTurnAgentOutputSchema,
  memoryAgentOutputSchema,
  questSynthesisOutputSchema,
  recoveryActionSchema,
  safetyReviewSchema,
  type CandidateProfile,
  type QuestProposal,
  availabilityWindowSchema,
} from "@/server/domain/schemas";
import { z } from "zod";

const coordinationAgentOutputSchema = z.object({
  reply: z.string().min(1),
  requirementPatch: z.object({
    availableWindows: z.array(availabilityWindowSchema).optional(),
    accessibility: z.array(z.string().min(1)).optional(),
    travel: z.array(z.string().min(1)).optional(),
    dietary: z.array(z.string().min(1)).optional(),
    environmental: z.array(z.string().min(1)).optional(),
    venuePreferences: z.array(z.string().min(1)).optional(),
    temporaryConflicts: z.array(z.string().min(1)).optional(),
    other: z.array(z.string().min(1)).optional(),
  }),
});

export function hostedRetrySettings(
  provider: Exclude<AgentProviderName, "deterministic">,
): ModelRetrySettings {
  return {
    // Gemini quota responses already include Google's retry guidance. Do not
    // sleep and spend another request inside a chat turn; surface the quota
    // state immediately so the member can try again later.
    maxRetries: provider === "gemini" ? 0 : 2,
    backoff: { initialDelayMs: 1_000, maxDelayMs: 60_000, multiplier: 2, jitter: true },
    policy: ({ normalized, providerAdvice }) => {
      if (provider === "gemini" && normalized.statusCode === 429) {
        // Deliberately never wait/retry a quota response. providerAdvice is
        // retained in the signature for the shared OpenAI policy shape.
        void providerAdvice;
        return false;
      }
      return normalized.isNetworkError
        || normalized.statusCode === 429
        || (normalized.statusCode ?? 0) >= 500;
    },
  };
}

export function hostedProviderErrorMessage(
  provider: Exclude<AgentProviderName, "deterministic">,
  error: unknown,
): string {
  if (provider === "gemini" && error && typeof error === "object" && "status" in error) {
    const status = error.status;
    if (status === 429 || status === "429") {
      const headers = "headers" in error ? error.headers : null;
      const getHeader = headers && typeof headers === "object" && "get" in headers
        && typeof headers.get === "function"
        ? (name: string) => (headers as { get(headerName: string): string | null }).get(name)
        : () => null;
      if (getHeader("x-gemini-quota-period") === "day") {
        return "Gemini's daily request quota for this model is exhausted. It resets at midnight Pacific time.";
      }
      const retrySeconds = parseRetryAfter(getHeader("retry-after"))
        ?? parseRetryHint(errorMessage(error));
      return retrySeconds !== null
        ? `Gemini request quota is temporarily exhausted. Please try again in about ${retrySeconds} seconds.`
        : "Gemini request quota is temporarily exhausted. Please try again later.";
    }
  }
  const message = error instanceof Error ? error.message : "Unknown hosted model error";
  return `${provider} provider unavailable: ${message}`;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1, Math.ceil(seconds));
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(1, Math.ceil((timestamp - Date.now()) / 1_000));
}

function parseRetryHint(message: string): number | null {
  const match = message.match(/retry(?: again)? in\s+([0-9]+(?:\.[0-9]+)?)\s*(?:s|seconds?)/i);
  if (!match?.[1]) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "";
}

interface HostedAgentRuntimeOptions {
  provider: Exclude<AgentProviderName, "deterministic">;
  models: Omit<HostedModelConfiguration, "embedding">;
  modelProvider: ModelProvider;
  auditSink?: AgentAuditSink;
}

export function normalizeGeminiVenueRequirements(requirements: string[]): string[] {
  const canonical = new Set(requirements);
  const normalized = requirements.map((requirement) =>
    requirement.toLowerCase().replaceAll("_", " ").replaceAll("-", " ")
  );
  if (normalized.some((requirement) =>
    requirement === "approved public location"
    || (/\bpublic\b/.test(requirement)
      && /\b(location|venue|community center|community centre|lounge|room)\b/.test(requirement))
  )) canonical.add("approved_public_location");
  if (normalized.some((requirement) => /\bindoor\b/.test(requirement))) {
    canonical.add("indoor");
  }
  if (normalized.some((requirement) =>
    /\b(no stairs|stair free|step free|no steps|without stairs)\b/.test(requirement)
  )) canonical.add("no_stairs");
  return [...canonical];
}

export class HostedAgentRuntime implements AgentRuntime {
  private readonly conversationAgent: Agent<unknown, typeof assistantTurnAgentOutputSchema>;
  private readonly memoryAgent: Agent<unknown, typeof memoryAgentOutputSchema>;
  private readonly synthesisAgent: Agent<unknown, typeof questSynthesisOutputSchema>;
  private readonly safetyAgent: Agent<unknown, typeof safetyReviewSchema>;
  private readonly recoveryAgent: Agent<unknown, typeof recoveryActionSchema>;
  private readonly coordinationAgent: Agent<unknown, typeof coordinationAgentOutputSchema>;
  private readonly runner: Runner;

  constructor(private readonly options: HostedAgentRuntimeOptions) {
    setTracingDisabled(true);
    this.runner = new Runner({ modelProvider: options.modelProvider });
    const persistenceSetting = options.provider === "openai" ? { store: false as const } : {};
    const retrySettings = hostedRetrySettings(options.provider);
    this.conversationAgent = new Agent({
      name: "Senior Quest conversation guide",
      model: options.models.memory,
      instructions: [
        "You are Senior Quest, a warm and concise guide helping an older adult describe one current community activity request.",
        "Ask exactly one useful question per turn and adapt its wording to the conversation; do not follow a scripted questionnaire.",
        "Extract only facts the participant explicitly stated. Never infer consent, availability, access needs, identity, contact details, or addresses.",
        "Treat all times collected in this conversation as provisional availability, never as a confirmed activity schedule.",
        "The newest current goal is authoritative. Do not blend previous or unrelated goals into it.",
        "Use requestedField only from the supplied missingFields. Return a briefPatch only for facts present in the latest user message.",
        "When no missing fields remain, set requestedField to null and give a short invitation to review the brief.",
        "Return only the requested structured output.",
      ].join(" "),
      outputType: assistantTurnAgentOutputSchema,
      modelSettings: { reasoning: { effort: "low" }, retry: retrySettings, ...persistenceSetting },
    });
    this.memoryAgent = new Agent({
      name: "Kampung personal memory",
      model: options.models.memory,
      instructions: [
        "Update a senior's human-readable memory from the supplied current snapshot and newly confirmed active quest request.",
        "The supplied currentSoftFacts.need is authoritative: replace the prior active need and never blend old active goals into it.",
        "Treat structured constraints as authoritative and never infer or modify them.",
        "Return only the requested structured output. Do not add identity or contact details.",
      ].join(" "),
      outputType: memoryAgentOutputSchema,
      modelSettings: { reasoning: { effort: "low" }, retry: retrySettings, ...persistenceSetting },
    });
    this.synthesisAgent = new Agent({
      name: "Kampung quest synthesis and matchmaking",
      model: options.models.synthesis,
      instructions: [
        "Design one practical, mutually beneficial public quest and select two to five participants.",
        "Treat the initiating user's current need as the primary objective. Historical interests are secondary and must never displace it.",
        "If candidates cannot directly support the primary objective, return the no_match outcome instead of inventing an unrelated activity.",
        "Always fill every output field: for proposal use proposal and primaryIntentRef with null reason and an empty missingCapabilities list; for no_match use a null proposal and primaryIntentRef with a clear reason and missingCapabilities.",
        "Use only participant aliases, stated needs, and stated contributions from the input.",
        "Return the supplied need and offer fact reference IDs in needsAddressed and contributionsUsed; never return fact text there.",
        "Every participant needs a meaningful role. Preserve exact availability, mobility, consent, and group limits.",
        "In venueRequirements, always use the exact token approved_public_location; also use indoor or no_stairs exactly when participant constraints require them.",
        "Never propose peer-to-peer money, private-home visits, or unsupported participants.",
        "When validation errors are supplied, correct only those errors.",
      ].join(" "),
      outputType: questSynthesisOutputSchema,
      modelSettings: { reasoning: { effort: "medium" }, retry: retrySettings, ...persistenceSetting },
    });
    this.safetyAgent = new Agent({
      name: "Kampung safety guardian",
      model: options.models.safety,
      instructions: [
        "Review only the supplied validated quest for contextual safety risk.",
        "Escalate money, private-home visits, coercion, distress, sensitive-data exposure, or unusual assignments.",
        "Do not redesign the quest. Return an approval, rejection, or human-review decision.",
      ].join(" "),
      outputType: safetyReviewSchema,
      modelSettings: { reasoning: { effort: "low" }, retry: retrySettings, ...persistenceSetting },
    });
    this.recoveryAgent = new Agent({
      name: "Kampung event recovery",
      model: options.models.recovery,
      instructions: [
        "Choose at most one supplied reserve alias to replace the unavailable participant.",
        "Return null when no reserve is suitable. Do not change the activity or create new participants.",
      ].join(" "),
      outputType: recoveryActionSchema,
      modelSettings: { reasoning: { effort: "low" }, retry: retrySettings, ...persistenceSetting },
    });
    this.coordinationAgent = new Agent({
      name: "Kampung event coordination",
      model: options.models.recovery,
      instructions: [
        "Help one participant coordinate one quest using only their private conversation.",
        "Extract only requirements explicitly stated in the latest message, such as availability, accessibility, travel, dietary or environmental needs, venue preferences, and temporary conflicts.",
        "Do not reveal or speculate about any other participant. Do not finalize a schedule, venue, participant change, invitation, or quest state.",
        "Explain that extracted requirements require participant confirmation before use.",
        "Return only the requested structured output.",
      ].join(" "),
      outputType: coordinationAgentOutputSchema,
      modelSettings: { reasoning: { effort: "low" }, retry: retrySettings, ...persistenceSetting },
    });
  }

  async conductConversation(input: Parameters<AgentRuntime["conductConversation"]>[0]) {
    return assistantTurnAgentOutputSchema.parse(await this.runStructured(this.conversationAgent, {
      transcript: input.messages.map(({ role, content }) => ({ role, content })),
      currentBrief: input.brief,
      missingFields: input.missingFields,
      rules: {
        oneQuestionPerTurn: true,
        explicitConsentRequired: true,
        preciseLocationForbidden: true,
      },
    }, { conversationId: input.conversationId }));
  }

  async updateMemory(input: MemoryAgentInput) {
    const alias = "p_1";
    const currentMarkdown = input.currentMemory?.markdown.replaceAll(input.profile.candidateId, alias) ?? null;
    const previous = input.currentMemory?.profile;
    const currentSoftFacts = {
      need: input.providedSoftFacts?.need === false && previous ? previous.need : input.profile.need,
      interests: input.providedSoftFacts?.interests === false && previous
        ? previous.interests
        : input.profile.interests,
      offers: input.providedSoftFacts?.offers === false && previous ? previous.offers : input.profile.offers,
    };
    const output = memoryAgentOutputSchema.parse(await this.runStructured(this.memoryAgent, {
      participant: alias,
      currentMarkdown,
      newNarrative: input.narrative,
      currentSoftFacts,
      authoritativeConstraints: input.profile.constraints,
    }, input.auditContext));
    return {
      ...output,
      markdown: output.markdown.replaceAll(alias, input.profile.candidateId),
    };
  }

  async synthesizeQuest(input: Parameters<AgentRuntime["synthesizeQuest"]>[0]) {
    const profiles = [input.initiator, ...input.candidates.map((candidate) => candidate.profile)];
    const aliases = this.aliases(profiles);
    const reverse = new Map([...aliases.entries()].map(([candidateId, alias]) => [alias, candidateId]));
    const output = questSynthesisOutputSchema.parse(await this.runStructured(this.synthesisAgent, {
      initiatingUser: this.safeProfile(input.initiator, aliases),
      candidates: input.candidates.map((candidate) => ({
        ...this.safeProfile(candidate.profile, aliases),
        scores: candidate.scores,
      })),
      validationErrors: input.validationErrors?.map((error) => ({
        ...error,
        candidateId: error.candidateId ? aliases.get(error.candidateId) : undefined,
      })) ?? [],
      proposalToCorrect: input.proposalToCorrect
        ? this.aliasProposalForSynthesis(input.proposalToCorrect, aliases)
        : null,
      rules: {
        minimumGroupSize: 2,
        maximumGroupSize: 5,
        maximumDurationMinutes: 120,
        publicVenueRequired: true,
        explicitConsentRequired: true,
        peerToPeerMoneyAllowed: false,
      },
    }, input.auditContext));
    if (output.outcome === "no_match") {
      if (!output.reason) throw new Error("Agent returned no reason for a no-match outcome");
      return { outcome: "no_match" as const, reason: output.reason, missingCapabilities: output.missingCapabilities };
    }
    if (!output.proposal || !output.primaryIntentRef) {
      throw new Error("Agent returned an incomplete proposal outcome");
    }
    return {
      outcome: "proposal" as const,
      primaryIntentRef: output.primaryIntentRef,
      proposal: this.restoreProposalReferences({
      ...output.proposal,
      quest: {
        ...output.proposal.quest,
        venueRequirements: normalizeGeminiVenueRequirements(output.proposal.quest.venueRequirements),
      },
      }, reverse, profiles),
    };
  }

  async reviewSafety(input: Parameters<AgentRuntime["reviewSafety"]>[0]) {
    const profiles = [...input.profiles.values()];
    const aliases = this.aliases(profiles);
    return safetyReviewSchema.parse(await this.runStructured(this.safetyAgent, {
      proposal: this.aliasProposalIds(input.proposal, aliases),
      participants: input.proposal.proposedParticipants.map((participant) =>
        this.safeProfile(input.profiles.get(participant.candidateId)!, aliases),
      ),
      policy: {
        publicVenueRequired: true,
        explicitConsentRequired: true,
        contactDetailsMustRemainPrivate: true,
        peerToPeerMoneyAllowed: false,
      },
    }, input.auditContext));
  }

  async recoverQuest(input: Parameters<AgentRuntime["recoverQuest"]>[0]) {
    if (!input.run.proposal) return { replacementCandidateId: null };
    const ids = [
      ...input.run.proposal.proposedParticipants.map((participant) => participant.candidateId),
      ...input.run.proposal.reserveCandidates.map((candidate) => candidate.candidateId),
    ];
    const aliases = new Map(ids.map((candidateId, index) => [candidateId, `p_${index + 1}`]));
    const reverse = new Map([...aliases.entries()].map(([candidateId, alias]) => [alias, candidateId]));
    const output = recoveryActionSchema.parse(await this.runStructured(this.recoveryAgent, {
      unavailableParticipant: aliases.get(input.unavailableCandidateId),
      reserves: input.run.proposal.reserveCandidates.map((reserve) => ({
        ...reserve,
        candidateId: aliases.get(reserve.candidateId),
      })),
      quest: input.run.proposal.quest,
    }, { questRunId: input.run.runId }));
    if (output.replacementCandidateId === null) return output;
    const candidateId = reverse.get(output.replacementCandidateId);
    if (!candidateId) throw new Error("Agent returned an unknown reserve participant");
    return { replacementCandidateId: candidateId };
  }

  async coordinateEvent(input: Parameters<AgentRuntime["coordinateEvent"]>[0]) {
    return coordinationAgentOutputSchema.parse(await this.runStructured(this.coordinationAgent, {
      quest: input.quest,
      transcript: input.messages,
      currentRequirements: input.currentRequirements,
      latestMessage: input.latestMessage,
      rules: {
        participantConfirmationRequired: true,
        otherParticipantDataForbidden: true,
        directStateMutationForbidden: true,
      },
    }, input.auditContext));
  }

  private async runStructured<TOutput extends AgentOutputType>(
    agent: Agent<unknown, TOutput>,
    input: unknown,
    metadata: Record<string, string> = {},
  ): Promise<unknown> {
    const startedAt = Date.now();
    const model = typeof agent.model === "string" ? agent.model : "custom-model";
    try {
      const result = await this.runner.run(agent, JSON.stringify(minimizeProviderInput(input)));
      if (!result.finalOutput) throw new Error("Agent returned no structured output");
      await this.audit({
        runId: `agent_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        role: agent.name,
        model,
        promptVersion: "v1",
        outcome: "succeeded",
        latencyMs: Date.now() - startedAt,
        inputTokens: result.state.usage.inputTokens,
        outputTokens: result.state.usage.outputTokens,
        metadata: { provider: this.options.provider, ...metadata },
      });
      return result.finalOutput;
    } catch (error) {
      await this.audit({
        runId: `agent_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        role: agent.name,
        model,
        promptVersion: "v1",
        outcome: "failed",
        latencyMs: Date.now() - startedAt,
        inputTokens: null,
        outputTokens: null,
        metadata: { provider: this.options.provider, ...metadata },
      });
      throw new Error(hostedProviderErrorMessage(this.options.provider, error), { cause: error });
    }
  }

  private async audit(record: Parameters<AgentAuditSink>[0]): Promise<void> {
    if (!this.options.auditSink) return;
    await this.options.auditSink(record).catch(() => undefined);
  }

  private aliases(profiles: CandidateProfile[]): Map<string, string> {
    return new Map(profiles.map((profile, index) => [profile.candidateId, `p_${index + 1}`]));
  }

  private safeProfile(profile: CandidateProfile, aliases: Map<string, string>) {
    return {
      candidateId: aliases.get(profile.candidateId),
      need: { ref: stableFactRef("need", profile.need), text: profile.need },
      interests: profile.interests.map((text) => ({ ref: stableFactRef("interest", text), text })),
      offers: profile.offers.map((text) => ({ ref: stableFactRef("offer", text), text })),
      constraints: profile.constraints,
      previousGroupScore: profile.previousGroupScore,
    };
  }

  private aliasProposalIds(proposal: QuestProposal, aliases: Map<string, string>): QuestProposal {
    return {
      ...structuredClone(proposal),
      proposedParticipants: proposal.proposedParticipants.map((participant) => ({
        ...participant,
        candidateId: aliases.get(participant.candidateId) ?? "unknown",
      })),
      reserveCandidates: proposal.reserveCandidates.map((candidate) => ({
        ...candidate,
        candidateId: aliases.get(candidate.candidateId) ?? "unknown",
      })),
    };
  }

  private aliasProposalForSynthesis(
    proposal: QuestProposal,
    aliases: Map<string, string>,
  ): QuestProposal {
    const aliased = this.aliasProposalIds(proposal, aliases);
    return {
      ...aliased,
      quest: {
        ...aliased.quest,
        needsAddressed: aliased.quest.needsAddressed.map((text) => stableFactRef("need", text)),
      },
      proposedParticipants: aliased.proposedParticipants.map((participant) => ({
        ...participant,
        needsAddressed: participant.needsAddressed.map((text) => stableFactRef("need", text)),
        contributionsUsed: participant.contributionsUsed.map((text) => stableFactRef("offer", text)),
      })),
    };
  }

  private restoreProposalReferences(
    proposal: QuestProposal,
    aliases: Map<string, string>,
    profiles: CandidateProfile[],
  ): QuestProposal {
    const restore = (alias: string): string => {
      const candidateId = aliases.get(alias);
      if (!candidateId) throw new Error("Agent returned an unknown participant alias");
      return candidateId;
    };
    const facts = new Map(profiles.map((profile) => [profile.candidateId, {
      needs: new Map([[stableFactRef("need", profile.need), profile.need]]),
      offers: new Map(profile.offers.map((text) => [stableFactRef("offer", text), text])),
    }]));
    const allNeeds = new Map(profiles.map((profile) => [stableFactRef("need", profile.need), profile.need]));
    const resolve = (candidateId: string, ref: string, kind: "needs" | "offers"): string => {
      const text = facts.get(candidateId)?.[kind].get(ref);
      if (!text) throw new Error(`Agent returned an unknown ${kind === "needs" ? "need" : "offer"} fact reference`);
      return text;
    };
    return {
      ...proposal,
      quest: {
        ...proposal.quest,
        needsAddressed: proposal.quest.needsAddressed.map((ref) => {
          const text = allNeeds.get(ref);
          if (!text) throw new Error("Agent returned an unknown quest need fact reference");
          return text;
        }),
      },
      proposedParticipants: proposal.proposedParticipants.map((participant) => ({
        ...participant,
        candidateId: restore(participant.candidateId),
        needsAddressed: participant.needsAddressed.map((ref) =>
          resolve(restore(participant.candidateId), ref, "needs")
        ),
        contributionsUsed: participant.contributionsUsed.map((ref) =>
          resolve(restore(participant.candidateId), ref, "offers")
        ),
      })),
      reserveCandidates: proposal.reserveCandidates.map((candidate) => ({
        ...candidate,
        candidateId: restore(candidate.candidateId),
      })),
    };
  }
}
