import type { AgentProviderName } from "@/server/agents/provider-configuration";
import { KampungQuestEngine } from "@/server/core/kampung-quest-engine";
import type {
  AssistantRecommendationCommand,
  CandidateProfile,
  MemoryAgentOutput,
  MemoryCard,
  QuestRun,
} from "@/server/domain/schemas";
import type { KampungStore } from "@/server/repositories/kampung-store";

export interface AssistantRecommendationResult {
  memory: MemoryCard;
  quest: QuestRun;
  provider: AgentProviderName;
  seededCandidateCount: number;
}

interface AssistantRecommendationDependencies {
  engine: KampungQuestEngine;
  store: KampungStore;
  provider: AgentProviderName;
  demoSeedEnabled: boolean;
}

const DEMO_NEIGHBOURS = [
  {
    candidateId: "demo_anne",
    need: "Would enjoy teaching neighbours how to prepare a healthy lunch",
    interests: ["healthy cooking", "community lunches"],
    offers: ["can teach a simple low-sodium recipe"],
  },
  {
    candidateId: "demo_david",
    need: "Wants friendly company and a reason to meet nearby neighbours",
    interests: ["walking", "conversation", "healthy living"],
    offers: ["can help organise a gentle group activity"],
  },
  {
    candidateId: "demo_john",
    need: "Would like to share useful skills in a small friendly group",
    interests: ["technology", "learning", "community"],
    offers: ["can help neighbours with phones and QR payments"],
  },
  {
    candidateId: "demo_mei",
    need: "Would like relaxed activities with neighbours close to home",
    interests: ["food", "crafts", "conversation"],
    offers: ["can welcome newcomers and prepare simple materials"],
  },
] as const;

export class AssistantRecommendationService {
  constructor(private readonly dependencies: AssistantRecommendationDependencies) {}

  async recommend(command: AssistantRecommendationCommand): Promise<AssistantRecommendationResult> {
    const idempotencyPrefix = `assistant:${command.candidateId}:${command.conversationId}`;
    let idempotencyKey = idempotencyPrefix;
    let failedAttempts = 0;
    let existingQuest = await this.dependencies.store.findQuestByIdempotencyKey(idempotencyKey);
    while (existingQuest) {
      if (existingQuest.status !== "failed") {
        const existingMemory = await this.dependencies.store.findMemory(command.candidateId);
        if (!existingMemory) throw new Error("Assistant quest exists without an active memory");
        return {
          memory: existingMemory,
          quest: existingQuest,
          provider: this.dependencies.provider,
          seededCandidateCount: 0,
        };
      }
      failedAttempts += 1;
      idempotencyKey = `${idempotencyPrefix}:retry:${existingQuest.runId}`;
      existingQuest = await this.dependencies.store.findQuestByIdempotencyKey(idempotencyKey);
    }
    const seededCandidateCount = this.dependencies.demoSeedEnabled
      ? await this.ensureDemoNeighbours(command)
      : 0;
    const currentMemory = await this.dependencies.store.findMemory(command.candidateId);
    const memory = failedAttempts > 0 && currentMemory
      ? currentMemory
      : await this.dependencies.engine.recordMemory({
          profile: this.profile({
            candidateId: command.candidateId,
            need: command.narrative,
            interests: command.interests,
            offers: command.offers,
            constraints: command.constraints,
            distanceFromInitiatorM: null,
          }),
          narrative: command.narrative,
          providedSoftFacts: {
            need: false,
            interests: true,
            offers: true,
          },
        });
    const quest = await this.dependencies.engine.proposeQuest({
      initiatingCandidateId: command.candidateId,
      idempotencyKey,
    });

    return {
      memory,
      quest,
      provider: this.dependencies.provider,
      seededCandidateCount,
    };
  }

  private async ensureDemoNeighbours(command: AssistantRecommendationCommand): Promise<number> {
    let seeded = 0;
    for (const [index, neighbour] of DEMO_NEIGHBOURS.entries()) {
      const distanceFromInitiatorM = Math.min(
        command.constraints.maximumDistanceM,
        250 + index * 150,
      );
      const profile = this.profile({
        ...neighbour,
        interests: [...neighbour.interests],
        offers: [...neighbour.offers],
        constraints: {
          ...command.constraints,
          minimumGroupSize: 2,
          maximumGroupSize: Math.min(4, command.constraints.maximumGroupSize),
          verified: true,
          invitationConsent: true,
        },
        distanceFromInitiatorM,
      });
      const current = await this.dependencies.store.findMemory(neighbour.candidateId);
      if (
        current
        && JSON.stringify(current.profile.constraints) === JSON.stringify(profile.constraints)
        && current.profile.distanceFromInitiatorM === profile.distanceFromInitiatorM
      ) continue;
      const narrative = `${neighbour.need}. ${neighbour.offers[0]}.`;
      await this.dependencies.engine.recordPreparedMemory(
        { profile, narrative },
        this.demoMemory(profile, narrative),
      );
      seeded += 1;
    }
    return seeded;
  }

  private demoMemory(profile: CandidateProfile, narrative: string): MemoryAgentOutput {
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
        ...profile.interests.map((item) => `- ${item}`),
        "",
        "# What the senior can contribute",
        "",
        ...profile.offers.map((item) => `- ${item}`),
      ].join("\n"),
    };
  }

  private profile(input: Pick<CandidateProfile,
    "candidateId" | "need" | "interests" | "offers" | "constraints" | "distanceFromInitiatorM"
  >): CandidateProfile {
    return {
      ...input,
      memoryStatus: "active",
      alreadyCommitted: false,
      relationshipBlocked: false,
      previousGroupScore: 0.5,
    };
  }
}
