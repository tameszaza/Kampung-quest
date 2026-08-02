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
  memoryAgentOutputSchema,
  questProposalSchema,
  recoveryActionSchema,
  safetyReviewSchema,
  type CandidateProfile,
  type QuestProposal,
} from "@/server/domain/schemas";

const retrySettings: ModelRetrySettings = {
  maxRetries: 2,
  backoff: { initialDelayMs: 250, maxDelayMs: 1_000, multiplier: 2, jitter: true },
  policy: ({ normalized }) =>
    normalized.isNetworkError || normalized.statusCode === 429 || (normalized.statusCode ?? 0) >= 500,
};

interface HostedAgentRuntimeOptions {
  provider: Exclude<AgentProviderName, "deterministic">;
  models: Omit<HostedModelConfiguration, "embedding">;
  modelProvider: ModelProvider;
  auditSink?: AgentAuditSink;
}

export class HostedAgentRuntime implements AgentRuntime {
  private readonly memoryAgent: Agent<unknown, typeof memoryAgentOutputSchema>;
  private readonly synthesisAgent: Agent<unknown, typeof questProposalSchema>;
  private readonly safetyAgent: Agent<unknown, typeof safetyReviewSchema>;
  private readonly recoveryAgent: Agent<unknown, typeof recoveryActionSchema>;
  private readonly runner: Runner;

  constructor(private readonly options: HostedAgentRuntimeOptions) {
    setTracingDisabled(true);
    this.runner = new Runner({ modelProvider: options.modelProvider });
    const persistenceSetting = options.provider === "openai" ? { store: false as const } : {};
    this.memoryAgent = new Agent({
      name: "Kampung personal memory",
      model: options.models.memory,
      instructions: [
        "Update a senior's human-readable memory from the supplied current snapshot and new narrative.",
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
        "Use only participant aliases, stated needs, and stated contributions from the input.",
        "Return the supplied need and offer fact reference IDs in needsAddressed and contributionsUsed; never return fact text there.",
        "Every participant needs a meaningful role. Preserve exact availability, mobility, consent, and group limits.",
        "Never propose peer-to-peer money, private-home visits, or unsupported participants.",
        "When validation errors are supplied, correct only those errors.",
      ].join(" "),
      outputType: questProposalSchema,
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
    }));
    return {
      ...output,
      markdown: output.markdown.replaceAll(alias, input.profile.candidateId),
    };
  }

  async synthesizeQuest(input: Parameters<AgentRuntime["synthesizeQuest"]>[0]) {
    const profiles = [input.initiator, ...input.candidates.map((candidate) => candidate.profile)];
    const aliases = this.aliases(profiles);
    const reverse = new Map([...aliases.entries()].map(([candidateId, alias]) => [alias, candidateId]));
    const proposal = questProposalSchema.parse(await this.runStructured(this.synthesisAgent, {
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
    }));
    return this.restoreProposalReferences(proposal, reverse, profiles);
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
    }));
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
    }));
    if (output.replacementCandidateId === null) return output;
    const candidateId = reverse.get(output.replacementCandidateId);
    if (!candidateId) throw new Error("Agent returned an unknown reserve participant");
    return { replacementCandidateId: candidateId };
  }

  private async runStructured<TOutput extends AgentOutputType>(
    agent: Agent<unknown, TOutput>,
    input: unknown,
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
        metadata: { provider: this.options.provider },
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
        metadata: { provider: this.options.provider },
      });
      const message = error instanceof Error ? error.message : "Unknown hosted model error";
      throw new Error(`${this.options.provider} provider unavailable: ${message}`, { cause: error });
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
