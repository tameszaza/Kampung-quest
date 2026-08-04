import { OpenAIProvider } from "@openai/agents";
import OpenAI from "openai";
import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
import {
  createConfiguredEmbeddingProvider,
} from "@/server/agents/configured-embedding-provider";
import { createGeminiCompatibleFetch } from "@/server/agents/gemini-provider-fetch";
import { HostedAgentRuntime } from "@/server/agents/openai-agent-runtime";
import {
  UnavailableAgentRuntime,
} from "@/server/agents/unavailable-agent-runtime";
import { resolveProviderConfiguration } from "@/server/agents/provider-configuration";
import { GeminiSvgThumbnailAgent } from "@/server/agents/gemini-svg-thumbnail-agent";
import { RetryingQuestImageAgent } from "@/server/agents/retrying-quest-image-agent";
import { MockInvitationAdapter, MockVenueAdapter } from "@/server/coordination/adapters";
import { KampungQuestEngine } from "@/server/core/kampung-quest-engine";
import { AssistantRecommendationService } from "@/server/features/assistant-recommendation-service";
import { AssistantConversationService } from "@/server/features/assistant-conversation-service";
import { EventCoordinator } from "@/server/features/event-coordinator";
import { findCommonAvailability } from "@/server/features/availability-service";
import { ConstraintValidator } from "@/server/features/validation-service";
import { SafetyGuardianService } from "@/server/features/safety-service";
import { QuestChatNotifier } from "@/server/features/quest-chat-notifier";
import { RecruitmentEligibilityService } from "@/server/features/recruitment-eligibility-service";
import { InMemoryKampungStore, type KampungStore } from "@/server/repositories/kampung-store";
import { PostgresKampungStore } from "@/server/repositories/postgres-kampung-store";
import { createQuestImageStorage } from "@/server/quest/quest-image-storage";
import { identityStore } from "@/server/identity/container";

const globals = globalThis as typeof globalThis & {
  kampungStore?: KampungStore;
};
type AgentOpenAIClient = NonNullable<
  NonNullable<ConstructorParameters<typeof OpenAIProvider>[0]>["openAIClient"]
>;

function createStore(): KampungStore {
  if (process.env.DATABASE_URL) return new PostgresKampungStore(process.env.DATABASE_URL);
  return new InMemoryKampungStore();
}

export const kampungStore = globals.kampungStore ?? createStore();
if (process.env.NODE_ENV !== "production") globals.kampungStore = kampungStore;

const providerConfiguration = resolveProviderConfiguration(process.env);

function createAgentDependencies() {
  if (providerConfiguration.provider === "deterministic") {
    return {
      agents: new DeterministicAgentRuntime(),
      embeddings: createConfiguredEmbeddingProvider(providerConfiguration),
      imageStorage: createQuestImageStorage(),
    };
  }
  if (!providerConfiguration.ready) {
    const keyName = providerConfiguration.provider === "gemini"
      ? "GEMINI_API_KEY"
      : "OPENAI_API_KEY";
    const reason = `${keyName} is required when AGENT_PROVIDER=${providerConfiguration.provider}`;
    return {
      agents: new UnavailableAgentRuntime(reason),
      embeddings: createConfiguredEmbeddingProvider(providerConfiguration),
      imageStorage: createQuestImageStorage(),
    };
  }
  const apiKey = providerConfiguration.apiKey;
  if (!apiKey) throw new Error(`Missing API key for ${providerConfiguration.provider}`);
  const geminiFetch = providerConfiguration.provider === "gemini"
    ? createGeminiCompatibleFetch()
    : undefined;
  const modelProvider = providerConfiguration.provider === "gemini"
    ? new OpenAIProvider({
        openAIClient: new OpenAI({
          apiKey,
          baseURL: providerConfiguration.baseURL,
          fetch: geminiFetch,
          maxRetries: 0,
          timeout: 90_000,
        }) as unknown as AgentOpenAIClient,
        useResponses: providerConfiguration.useResponses,
        strictFeatureValidation: false,
      })
    : new OpenAIProvider({
        apiKey,
        baseURL: providerConfiguration.baseURL,
        useResponses: providerConfiguration.useResponses,
        strictFeatureValidation: false,
      });
  const geminiSvgAgent = providerConfiguration.provider === "gemini"
    ? new GeminiSvgThumbnailAgent({
        apiKey,
        model: process.env.GEMINI_SVG_IMAGE_MODEL ?? providerConfiguration.models.memory,
        baseURL: providerConfiguration.baseURL ?? "https://generativelanguage.googleapis.com/v1beta/openai/",
        fetch: geminiFetch,
      })
    : undefined;
  return {
    agents: new HostedAgentRuntime({
      provider: providerConfiguration.provider,
      models: providerConfiguration.models,
      modelProvider,
      auditSink: (record) => kampungStore.recordAgentRun(record),
    }),
    embeddings: createConfiguredEmbeddingProvider(providerConfiguration, geminiFetch),
    imageAgent: geminiSvgAgent ? new RetryingQuestImageAgent(geminiSvgAgent) : undefined,
    imageStorage: createQuestImageStorage(),
  };
}

const agentDependencies = createAgentDependencies();

const questChatNotifier = new QuestChatNotifier(identityStore, kampungStore);

const eventConstraintValidator = new ConstraintValidator();
const eventSafetyGuardian = new SafetyGuardianService();
const recruitmentEligibility = new RecruitmentEligibilityService(kampungStore);

export const eventCoordinator = new EventCoordinator({
  store: kampungStore,
  resolveMember: async (userId) => {
    const member = await identityStore.findUserById(userId);
    return member ? { displayName: member.fullName, photoUrl: member.photoUrl } : null;
  },
  resolveParticipant: async (userId) => {
    const memory = await kampungStore.findMemory(userId);
    const profile = memory?.profile;
    if (!profile
      || profile.memoryStatus !== "active"
      || profile.alreadyCommitted
      || profile.relationshipBlocked
      || !profile.constraints.verified
      || !profile.constraints.invitationConsent) return null;
    return {
      participant: {
        candidateId: userId,
        proposedRole: "supporting_participant",
        needsAddressed: [profile.need],
        contributionsUsed: [profile.offers[0] ?? "participate and support the group"],
      },
      explanation: ["Selected by you"],
    };
  },
  resolveGroupSizeRange: async (userIds) => {
    const profiles = (await Promise.all(userIds.map((userId) => kampungStore.findMemory(userId))))
      .flatMap((memory) => memory?.profile ? [memory.profile] : []);
    if (profiles.length !== userIds.length) return null;
    return {
      minimum: Math.max(...profiles.map((profile) => profile.constraints.minimumGroupSize)),
      maximum: Math.min(...profiles.map((profile) => profile.constraints.maximumGroupSize)),
    };
  },
  assessRecruitmentCandidate: (state, userId) => recruitmentEligibility.assess(state, userId),
  validateRoster: async (proposal) => {
    const cards = await kampungStore.listMemories();
    const profiles = new Map(cards.map((card) => [card.profile.candidateId, card.profile]));
    const validation = eventConstraintValidator.validate(proposal, profiles);
    if (!validation.valid) return validation;
    const safety = eventSafetyGuardian.review(proposal, profiles);
    return safety.status === "approved" ? validation : {
      valid: false,
      errors: [{ field: "safety", message: "The modified group requires coordinator review." }],
    };
  },
  validateArrangement: async ({ state, start, end }) => {
    const cards = await kampungStore.listMemories();
    const profiles = new Map(cards.map((card) => [card.profile.candidateId, card.profile]));
    const errors = state.memberships
      .filter((membership) => !["withdrawn", "replaced", "cancelled"].includes(membership.status))
      .flatMap((membership) => {
        const confirmedWindows = state.threads.find((thread) => thread.userId === membership.userId)
          ?.confirmedRequirements.availableWindows ?? [];
        const windows = confirmedWindows.length
          ? confirmedWindows
          : profiles.get(membership.userId)?.constraints.availableWindows ?? [];
        const fits = windows.some((window) => Date.parse(window.start) <= Date.parse(start)
          && Date.parse(window.end) >= Date.parse(end));
        return fits ? [] : [{
          candidateId: membership.userId,
          field: "availability",
          message: "The proposed time is outside at least one participant's confirmed availability.",
        }];
      });
    return { valid: errors.length === 0, errors };
  },
  suggestArrangement: async (state) => {
    const cards = await kampungStore.listMemories();
    const profiles = new Map(cards.map((card) => [card.profile.candidateId, card.profile]));
    const activeMemberships = state.memberships.filter((membership) =>
      !["withdrawn", "replaced", "cancelled", "completed"].includes(membership.status));
    const windows = activeMemberships.map((membership) => {
      const confirmed = state.threads.find((thread) => thread.userId === membership.userId)
        ?.confirmedRequirements.availableWindows ?? [];
      return confirmed.length ? confirmed : profiles.get(membership.userId)?.constraints.availableWindows ?? [];
    });
    const overlap = findCommonAvailability(windows, state.proposal.quest.durationMinutes);
    if (!overlap) return null;
    return {
      ...overlap,
      venueName: "Community venue (opening hours to verify)",
      venueAddress: null,
    };
  },
  coordinate: async ({ state, thread, message }) => agentDependencies.agents.coordinateEvent({
    quest: {
      title: state.proposal.quest.title,
      description: state.proposal.quest.description,
      durationMinutes: state.proposal.quest.durationMinutes,
    },
    messages: thread.messages.map(({ role, body }) => ({ role, body })),
    currentRequirements: thread.confirmedRequirements,
    latestMessage: message,
    auditContext: { questRunId: state.runId, coordinationThreadId: thread.threadId },
  }),
});

export const kampungQuestEngine = new KampungQuestEngine({
  store: kampungStore,
  ...agentDependencies,
  invitations: new MockInvitationAdapter(),
  venues: new MockVenueAdapter(),
  chatNotifier: questChatNotifier,
  eventCoordinator,
  filterContactableCandidateIds: (candidateIds) => identityStore.filterContactableUserIds(candidateIds),
});

export const assistantRecommendationService = new AssistantRecommendationService({
  engine: kampungQuestEngine,
  store: kampungStore,
  provider: providerConfiguration.provider,
  demoSeedEnabled: process.env.DEMO_SEED_ENABLED === "true"
    || (process.env.DEMO_SEED_ENABLED === undefined && process.env.NODE_ENV !== "production"),
});

export const assistantConversationService = new AssistantConversationService({
  store: kampungStore,
  agents: agentDependencies.agents,
  recommendations: assistantRecommendationService,
  allowDemoNeighbors: async (candidateId) => (await identityStore.findUserById(candidateId))?.username === "test",
});

export const runtimeConfiguration = {
  store: process.env.DATABASE_URL ? "postgresql" : "in-memory",
  agentProvider: providerConfiguration.provider,
  agentProviderReady: providerConfiguration.ready,
};
