import { OpenAIProvider } from "@openai/agents";
import OpenAI from "openai";
import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
import {
  DeterministicEmbeddingProvider,
  HostedEmbeddingProvider,
} from "@/server/agents/embedding-provider";
import { createGeminiCompatibleFetch } from "@/server/agents/gemini-provider-fetch";
import { HostedAgentRuntime } from "@/server/agents/openai-agent-runtime";
import {
  UnavailableAgentRuntime,
  UnavailableEmbeddingProvider,
} from "@/server/agents/unavailable-agent-runtime";
import { resolveProviderConfiguration } from "@/server/agents/provider-configuration";
import { MockInvitationAdapter, MockVenueAdapter } from "@/server/coordination/adapters";
import { KampungQuestEngine } from "@/server/core/kampung-quest-engine";
import { AssistantRecommendationService } from "@/server/features/assistant-recommendation-service";
import { AssistantConversationService } from "@/server/features/assistant-conversation-service";
import { InMemoryKampungStore, type KampungStore } from "@/server/repositories/kampung-store";
import { PostgresKampungStore } from "@/server/repositories/postgres-kampung-store";

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
      embeddings: new DeterministicEmbeddingProvider(),
    };
  }
  if (!providerConfiguration.ready) {
    const keyName = providerConfiguration.provider === "gemini"
      ? "GEMINI_API_KEY"
      : "OPENAI_API_KEY";
    const reason = `${keyName} is required when AGENT_PROVIDER=${providerConfiguration.provider}`;
    return {
      agents: new UnavailableAgentRuntime(reason),
      embeddings: new UnavailableEmbeddingProvider(reason),
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
  return {
    agents: new HostedAgentRuntime({
      provider: providerConfiguration.provider,
      models: providerConfiguration.models,
      modelProvider,
      auditSink: (record) => kampungStore.recordAgentRun(record),
    }),
    embeddings: new HostedEmbeddingProvider({
      provider: providerConfiguration.provider,
      apiKey,
      baseURL: providerConfiguration.baseURL,
      model: providerConfiguration.models.embedding,
      dimensions: providerConfiguration.embeddingDimensions,
      fetch: geminiFetch,
    }),
  };
}

const agentDependencies = createAgentDependencies();

export const kampungQuestEngine = new KampungQuestEngine({
  store: kampungStore,
  ...agentDependencies,
  invitations: new MockInvitationAdapter(),
  venues: new MockVenueAdapter(),
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
});

export const runtimeConfiguration = {
  store: process.env.DATABASE_URL ? "postgresql" : "in-memory",
  agentProvider: providerConfiguration.provider,
  agentProviderReady: providerConfiguration.ready,
};
