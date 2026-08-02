import { OpenAIProvider } from "@openai/agents";
import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
import {
  DeterministicEmbeddingProvider,
  HostedEmbeddingProvider,
} from "@/server/agents/embedding-provider";
import { HostedAgentRuntime } from "@/server/agents/openai-agent-runtime";
import { resolveProviderConfiguration } from "@/server/agents/provider-configuration";
import { MockInvitationAdapter, MockVenueAdapter } from "@/server/coordination/adapters";
import { KampungQuestEngine } from "@/server/core/kampung-quest-engine";
import { InMemoryKampungStore, type KampungStore } from "@/server/repositories/kampung-store";
import { PostgresKampungStore } from "@/server/repositories/postgres-kampung-store";

const globals = globalThis as typeof globalThis & {
  kampungStore?: KampungStore;
};

function createStore(): KampungStore {
  if (process.env.DATABASE_URL) return new PostgresKampungStore(process.env.DATABASE_URL);
  return new InMemoryKampungStore();
}

export const kampungStore = globals.kampungStore ?? createStore();
if (process.env.NODE_ENV !== "production") globals.kampungStore = kampungStore;

const providerConfiguration = resolveProviderConfiguration(process.env);
if (!providerConfiguration.ready) {
  const keyName = providerConfiguration.provider === "gemini"
    ? "GEMINI_API_KEY"
    : "OPENAI_API_KEY";
  throw new Error(`${keyName} is required when AGENT_PROVIDER=${providerConfiguration.provider}`);
}

function createAgentDependencies() {
  if (providerConfiguration.provider === "deterministic") {
    return {
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    };
  }
  const apiKey = providerConfiguration.apiKey;
  if (!apiKey) throw new Error(`Missing API key for ${providerConfiguration.provider}`);
  const modelProvider = new OpenAIProvider({
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

export const runtimeConfiguration = {
  store: process.env.DATABASE_URL ? "postgresql" : "in-memory",
  agentProvider: providerConfiguration.provider,
  agentProviderReady: providerConfiguration.ready,
};
