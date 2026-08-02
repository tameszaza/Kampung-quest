import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
import {
  DeterministicEmbeddingProvider,
  OpenAIEmbeddingProvider,
} from "@/server/agents/embedding-provider";
import { OpenAIAgentRuntime } from "@/server/agents/openai-agent-runtime";
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

const useOpenAI = process.env.AGENT_PROVIDER === "openai";
if (useOpenAI && !process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required when AGENT_PROVIDER=openai");
}

export const kampungQuestEngine = new KampungQuestEngine({
  store: kampungStore,
  agents: useOpenAI
    ? new OpenAIAgentRuntime((record) => kampungStore.recordAgentRun(record))
    : new DeterministicAgentRuntime(),
  embeddings: useOpenAI ? new OpenAIEmbeddingProvider() : new DeterministicEmbeddingProvider(),
  invitations: new MockInvitationAdapter(),
  venues: new MockVenueAdapter(),
});

export const runtimeConfiguration = {
  store: process.env.DATABASE_URL ? "postgresql" : "in-memory",
  agentProvider: useOpenAI ? "openai" : "deterministic",
  agentProviderReady: !useOpenAI || Boolean(process.env.OPENAI_API_KEY),
};
