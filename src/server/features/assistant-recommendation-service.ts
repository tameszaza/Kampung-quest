import { isDeepStrictEqual } from "node:util";
import type { AgentProviderName } from "@/server/agents/provider-configuration";
import { KampungQuestEngine, type QuestPipelineEvent } from "@/server/core/kampung-quest-engine";
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

export type AssistantRecommendationObserver = (event: QuestPipelineEvent | {
  stage: "memory";
  status: "started" | "completed" | "failed";
  message: string;
  kind: "agent" | "system";
}) => Promise<void> | void;

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
  {
    candidateId: "demo_aisha",
    need: "Would enjoy sharing safe food preparation skills with neighbours",
    interests: ["food safety", "salads", "cooking"],
    offers: ["can guide safe preparation of fish, salads, and shared meals"],
  },
  {
    candidateId: "demo_ravi",
    need: "Would like company for basketball and other sports broadcasts",
    interests: ["NBA", "basketball", "healthy snacks"],
    offers: ["can host sports discussions and explain the game"],
  },
  {
    candidateId: "demo_lim",
    need: "Would like to garden and exchange plant-care tips",
    interests: ["gardening", "herbs", "outdoors"],
    offers: ["can share seedlings and teach simple container gardening"],
  },
  {
    candidateId: "demo_sofia",
    need: "Would enjoy relaxed tabletop games with a small group",
    interests: ["board games", "cards", "puzzles"],
    offers: ["can teach accessible card and board games"],
  },
  {
    candidateId: "demo_farah",
    need: "Would like friendly language practice with neighbours",
    interests: ["languages", "stories", "conversation"],
    offers: ["can help with English and Malay conversation practice"],
  },
  {
    candidateId: "demo_kumar",
    need: "Would enjoy making and listening to music with others",
    interests: ["music", "singing", "old songs"],
    offers: ["can lead a gentle sing-along and bring a small speaker"],
  },
  {
    candidateId: "demo_helen",
    need: "Would like company for nearby errands and shopping",
    interests: ["markets", "errands", "neighbourhood walks"],
    offers: ["can help plan a short accessible shopping trip"],
  },
  {
    candidateId: "demo_noor",
    need: "Would enjoy gentle movement and wellbeing activities",
    interests: ["stretching", "gentle exercise", "wellbeing"],
    offers: ["can guide a seated stretching routine"],
  },
] as const;

const DEMO_LANGUAGES: Record<(typeof DEMO_NEIGHBOURS)[number]["candidateId"], string[]> = {
  demo_anne: ["English", "Chinese"],
  demo_david: ["English"],
  demo_john: ["English", "Chinese"],
  demo_mei: ["English", "Chinese"],
  demo_aisha: ["English", "Malay"],
  demo_ravi: ["English", "Tamil"],
  demo_lim: ["English", "Chinese"],
  demo_sofia: ["English"],
  demo_farah: ["English", "Malay"],
  demo_kumar: ["English", "Tamil"],
  demo_helen: ["English"],
  demo_noor: ["English", "Malay"],
};

export class AssistantRecommendationService {
  constructor(private readonly dependencies: AssistantRecommendationDependencies) {}

  async recommend(
    command: AssistantRecommendationCommand,
    observe?: AssistantRecommendationObserver,
  ): Promise<AssistantRecommendationResult> {
    const idempotencyPrefix = `assistant:${command.candidateId}:${command.requestKey ?? command.conversationId}`;
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
    const currentMemory = await this.dependencies.store.findMemory(command.candidateId);
    const reuseActiveMemory = failedAttempts > 0 && currentMemory !== null;
    await observe?.({
      stage: "memory",
      status: "started",
      message: reuseActiveMemory ? "Reusing the persisted active request for retry" : "Memory Keeper is updating the active request",
      kind: reuseActiveMemory ? "system" : "agent",
    });
    let memory: MemoryCard;
    try {
      memory = reuseActiveMemory
        ? currentMemory!
        : await this.dependencies.engine.recordMemory({
            profile: this.profile({
              candidateId: command.candidateId,
              source: "real",
              need: command.narrative,
              interests: command.interests,
              offers: command.offers,
              constraints: command.constraints,
              distanceFromInitiatorM: null,
            }),
            narrative: command.narrative,
            providedSoftFacts: {
              need: true,
              interests: true,
              offers: true,
            },
            auditContext: { conversationId: command.conversationId },
          });
    } catch (error) {
      await observe?.({ stage: "memory", status: "failed", message: "Memory Keeper could not update the active request", kind: "agent" });
      throw error;
    }
    await observe?.({
      stage: "memory",
      status: "completed",
      message: "Active request and preferences are ready",
      kind: reuseActiveMemory ? "system" : "agent",
    });
    let seededCandidateCount = 0;
    try {
      seededCandidateCount = this.dependencies.demoSeedEnabled
        ? await this.ensureDemoNeighbours(command)
        : 0;
    } catch (error) {
      await observe?.({ stage: "retrieval", status: "failed", message: "Neighbour demo availability could not be refreshed", kind: "system" });
      throw error;
    }
    const quest = await this.dependencies.engine.proposeQuest({
      initiatingCandidateId: command.candidateId,
      idempotencyKey,
      conversationId: command.conversationId,
    }, observe ? (event) => observe(event) : undefined);

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
      const distanceFromInitiatorM = 250 + index * 150;
      const profile = this.profile({
        ...neighbour,
        source: "demo",
        interests: [...neighbour.interests],
        offers: [...neighbour.offers],
        constraints: {
          availableWindows: command.constraints.availableWindows,
          maximumDistanceM: 2_000,
          minimumGroupSize: 2,
          maximumGroupSize: 4,
          indoorRequired: false,
          stairsAllowed: index % 4 !== 0,
          dietaryRequirements: [],
          languages: DEMO_LANGUAGES[neighbour.candidateId],
          verified: true,
          invitationConsent: true,
        },
        distanceFromInitiatorM,
      });
      const current = await this.dependencies.store.findMemory(neighbour.candidateId);
      if (
        current
        && current.profile.source === "demo"
        && isDeepStrictEqual(current.profile.constraints, profile.constraints)
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
    "candidateId" | "source" | "need" | "interests" | "offers" | "constraints" | "distanceFromInitiatorM"
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
