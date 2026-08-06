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
import { AGENT_INSTRUCTIONS } from "@/server/agents/agent-instructions";
import {
  coordinationProviderOutputSchema,
  normalizeCoordinationProviderOutput,
} from "@/server/agents/coordination-agent-output";
import type { AgentProviderName, HostedModelConfiguration } from "@/server/agents/provider-configuration";
import { minimizeProviderInput, stableFactRef } from "@/server/agents/provider-privacy";
import {
  eventTaskPlanAgentOutputSchema,
  eventTaskReassignmentAgentOutputSchema,
  type EventTaskPlanAgentInput,
  type EventTaskPlanAgentOutput,
} from "@/server/domain/event-tasks";
import {
  hostedAssistantTurnAgentOutputSchema,
  memoryAgentOutputSchema,
  normalizeHostedAssistantTurnOutput,
  questSynthesisOutputSchema,
  recoveryActionSchema,
  safetyReviewSchema,
  type CandidateProfile,
  type QuestProposal,
} from "@/server/domain/schemas";
import { SafetyGuardianService } from "@/server/features/safety-service";
export { normalizeHostedLocalTime } from "@/server/domain/schemas";

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

export class AgentOutputContractError extends Error {
  constructor(message = "Matchmaking could not verify the supplied participant facts") {
    super(message);
    this.name = "AgentOutputContractError";
  }
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
  private readonly conversationAgent: Agent<unknown, typeof hostedAssistantTurnAgentOutputSchema>;
  private readonly memoryAgent: Agent<unknown, typeof memoryAgentOutputSchema>;
  private readonly synthesisAgent: Agent<unknown, typeof questSynthesisOutputSchema>;
  private readonly safetyGuardian = new SafetyGuardianService();
  private readonly recoveryAgent: Agent<unknown, typeof recoveryActionSchema>;
  private readonly coordinationAgent: Agent<unknown, typeof coordinationProviderOutputSchema>;
  private readonly taskPlanAgent: Agent<unknown, typeof eventTaskPlanAgentOutputSchema>;
  private readonly taskReassignmentAgent: Agent<unknown, typeof eventTaskReassignmentAgentOutputSchema>;
  private readonly runner: Runner;

  constructor(private readonly options: HostedAgentRuntimeOptions) {
    setTracingDisabled(true);
    this.runner = new Runner({ modelProvider: options.modelProvider });
    const persistenceSetting = options.provider === "openai" ? { store: false as const } : {};
    const retrySettings = hostedRetrySettings(options.provider);
    this.conversationAgent = new Agent({
      name: "Senior Quest conversation guide",
      model: options.models.memory,
      instructions: AGENT_INSTRUCTIONS.conversation,
      outputType: hostedAssistantTurnAgentOutputSchema,
      modelSettings: { reasoning: { effort: "low" }, retry: retrySettings, ...persistenceSetting },
    });
    this.memoryAgent = new Agent({
      name: "Kampung personal memory",
      model: options.models.memory,
      instructions: AGENT_INSTRUCTIONS.memory,
      outputType: memoryAgentOutputSchema,
      modelSettings: { reasoning: { effort: "low" }, retry: retrySettings, ...persistenceSetting },
    });
    this.synthesisAgent = new Agent({
      name: "Kampung quest synthesis and matchmaking",
      model: options.models.synthesis,
      instructions: AGENT_INSTRUCTIONS.synthesis,
      outputType: questSynthesisOutputSchema,
      modelSettings: { reasoning: { effort: "medium" }, retry: retrySettings, ...persistenceSetting },
    });
    this.recoveryAgent = new Agent({
      name: "Kampung event recovery",
      model: options.models.recovery,
      instructions: AGENT_INSTRUCTIONS.recovery,
      outputType: recoveryActionSchema,
      modelSettings: { reasoning: { effort: "low" }, retry: retrySettings, ...persistenceSetting },
    });
    this.coordinationAgent = new Agent({
      name: "Kampung event coordination",
      model: options.models.recovery,
      instructions: AGENT_INSTRUCTIONS.coordination,
      outputType: coordinationProviderOutputSchema,
      modelSettings: { reasoning: { effort: "low" }, retry: retrySettings, ...persistenceSetting },
    });
    this.taskPlanAgent = new Agent({
      name: "Kampung event task planner",
      model: options.models.recovery,
      instructions: AGENT_INSTRUCTIONS.taskPlan,
      outputType: eventTaskPlanAgentOutputSchema,
      modelSettings: { reasoning: { effort: "low" }, retry: retrySettings, ...persistenceSetting },
    });
    this.taskReassignmentAgent = new Agent({
      name: "Kampung event task reassignment",
      model: options.models.recovery,
      instructions: AGENT_INSTRUCTIONS.taskReassignment,
      outputType: eventTaskReassignmentAgentOutputSchema,
      modelSettings: { reasoning: { effort: "low" }, retry: retrySettings, ...persistenceSetting },
    });
  }

  async conductConversation(input: Parameters<AgentRuntime["conductConversation"]>[0]) {
    const output = await this.runStructured(this.conversationAgent, {
      transcript: input.messages.map(({ role, content }) => ({ role, content })),
      currentBrief: input.brief,
      missingFields: input.missingFields,
      rules: {
        oneQuestionPerTurn: true,
        explicitConsentRequired: true,
        preciseLocationForbidden: true,
      },
    }, { conversationId: input.conversationId });
    try {
      return normalizeHostedAssistantTurnOutput(hostedAssistantTurnAgentOutputSchema.parse(output));
    } catch (error) {
      throw new Error(hostedProviderErrorMessage(this.options.provider, error), { cause: error });
    }
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
        minimumGroupSize: 1,
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
    try {
      return {
        outcome: "proposal" as const,
        primaryIntentRef: output.primaryIntentRef,
        proposal: restoreProposalReferences({
          ...output.proposal,
          quest: {
            ...output.proposal.quest,
            venueRequirements: normalizeGeminiVenueRequirements(output.proposal.quest.venueRequirements),
          },
        }, reverse, profiles),
      };
    } catch (error) {
      if (error instanceof AgentOutputContractError) {
        return {
          outcome: "no_match" as const,
          reason: "I could not verify a reliable match from the available member information. Please try again.",
          missingCapabilities: input.initiator.interests,
        };
      }
      throw error;
    }
  }

  async reviewSafety(input: Parameters<AgentRuntime["reviewSafety"]>[0]) {
    // Quest validation has already checked the structured constraints. Keep
    // the final safety decision evidence-based and deterministic so a hosted
    // model cannot invent a condition that blocks an otherwise valid quest.
    return safetyReviewSchema.parse(this.safetyGuardian.review(input.proposal, input.profiles));
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

  async generateEventTaskPlan(input: EventTaskPlanAgentInput): Promise<EventTaskPlanAgentOutput> {
    const aliases = new Map(input.participants.map((participant, index) => [participant.userId, `p_${index + 1}`]));
    const reverse = new Map([...aliases.entries()].map(([userId, alias]) => [alias, userId]));
    const output = eventTaskPlanAgentOutputSchema.parse(await this.runStructured(this.taskPlanAgent, {
      quest: input.quest,
      appointment: input.appointment,
      participants: input.participants.map((participant) => ({
        ...participant,
        userId: aliases.get(participant.userId),
        isOrganizer: participant.userId === input.organizerId,
      })),
      rules: {
        taskCount: "3-5 total",
        points: { easy: 10, medium: 20, hard: 30 },
        independentOrganizerReview: "A task assigned to the organizer must leave at least one other participant unassigned as its verifier.",
        noDirectStateMutation: true,
      },
    }, { questTitle: input.quest.title }));
    return {
      roles: output.roles.map((role) => ({ ...role, userId: reverse.get(role.userId) ?? role.userId })),
      tasks: output.tasks.map((task) => ({
        ...task,
        roleUserId: task.roleUserId ? reverse.get(task.roleUserId) ?? task.roleUserId : undefined,
        assigneeIds: task.assigneeIds.map((userId) => reverse.get(userId) ?? userId),
      })),
    };
  }

  async proposeEventTaskReassignment(input: Parameters<AgentRuntime["proposeEventTaskReassignment"]>[0]) {
    const ids = [input.participant.userId, ...input.task.assignees.map((assignee) => assignee.userId)];
    const aliases = new Map([...new Set(ids)].map((userId, index) => [userId, `p_${index + 1}`]));
    const output = eventTaskReassignmentAgentOutputSchema.parse(await this.runStructured(this.taskReassignmentAgent, {
      task: {
        ...input.task,
        assignees: input.task.assignees.map((assignee) => ({
          ...assignee,
          userId: aliases.get(assignee.userId),
        })),
      },
      participant: {
        ...input.participant,
        userId: aliases.get(input.participant.userId),
      },
      reason: input.reason,
      rules: { preserveDifficulty: true, noDirectStateMutation: true },
    }, { taskTitle: input.task.title }));
    return { ...output, difficulty: input.task.difficulty };
  }

  async coordinateEvent(input: Parameters<AgentRuntime["coordinateEvent"]>[0]) {
    return normalizeCoordinationProviderOutput(await this.runStructured(this.coordinationAgent, {
      quest: input.quest,
      transcript: input.messages,
      currentRequirements: input.currentRequirements,
      currentAppointment: input.currentAppointment ?? null,
      latestSuggestion: input.latestSuggestion ?? null,
      timeZone: input.timeZone ?? "Asia/Singapore",
      scope: input.scope ?? "private",
      latestMessage: input.latestMessage,
      rules: {
        compatibleAppointmentRequestsShouldBecomeStructuredChangeIntents: true,
        explicitConfirmationTargetsCurrentVisibleVersion: true,
        ordinaryGroupConversationIsSocial: true,
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
        promptVersion: "v2",
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
        promptVersion: "v2",
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

}

export function restoreProposalReferences(
  proposal: QuestProposal,
  aliases: Map<string, string>,
  profiles: CandidateProfile[],
): QuestProposal {
  const restore = (alias: string): string => {
    const candidateId = aliases.get(alias);
    if (!candidateId) throw new AgentOutputContractError();
    return candidateId;
  };
  const facts = new Map(profiles.map((profile) => [profile.candidateId, {
    needs: new Map([[stableFactRef("need", profile.need), profile.need]]),
    offers: new Map(profile.offers.map((text) => [stableFactRef("offer", text), text])),
  }]));
  const factText = new Map(profiles.map((profile) => [profile.candidateId, {
    needs: new Map([[normalizeFactText(profile.need), profile.need]]),
    offers: new Map(profile.offers.map((text) => [normalizeFactText(text), text])),
  }]));
  const allNeeds = new Map(profiles.map((profile) => [stableFactRef("need", profile.need), profile.need]));
  const allNeedText = new Map(profiles.map((profile) => [normalizeFactText(profile.need), profile.need]));
  const resolve = (candidateId: string, ref: string, kind: "needs" | "offers"): string => {
    const text = facts.get(candidateId)?.[kind].get(ref)
      ?? factText.get(candidateId)?.[kind].get(normalizeFactText(ref));
    if (!text) throw new AgentOutputContractError();
    return text;
  };
  return {
    ...proposal,
    quest: {
      ...proposal.quest,
      needsAddressed: proposal.quest.needsAddressed.map((ref) => {
        const text = allNeeds.get(ref) ?? allNeedText.get(normalizeFactText(ref));
        if (!text) throw new AgentOutputContractError();
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

function normalizeFactText(value: string): string {
  return value.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
}
