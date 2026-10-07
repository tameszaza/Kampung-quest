import {
  DeterministicEmbeddingProvider,
  HostedEmbeddingProvider,
  type EmbeddingProvider,
} from "@/server/agents/embedding-provider";
import { createGeminiCompatibleFetch } from "@/server/agents/gemini-provider-fetch";
import type { ProviderConfiguration } from "@/server/agents/provider-configuration";
import { UnavailableEmbeddingProvider } from "@/server/agents/unavailable-agent-runtime";
import { isProductionRuntime } from "@/server/runtime-environment";
import { createApplicationAiFetch } from "@/server/security/application-ai-control";

export function createConfiguredEmbeddingProvider(
  configuration: ProviderConfiguration,
  providerFetch?: typeof fetch,
): EmbeddingProvider {
  if (configuration.provider === "deterministic") return new DeterministicEmbeddingProvider();
  if (!configuration.ready || !configuration.apiKey) {
    const keyName = configuration.provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
    if (isProductionRuntime()) throw new Error(`${keyName} is required when AGENT_PROVIDER=${configuration.provider}`);
    return new UnavailableEmbeddingProvider(
      `${keyName} is required when AGENT_PROVIDER=${configuration.provider}`,
    );
  }
  return new HostedEmbeddingProvider({
    provider: configuration.provider,
    apiKey: configuration.apiKey,
    baseURL: configuration.baseURL,
    model: configuration.models.embedding,
    dimensions: configuration.embeddingDimensions,
    fetch: providerFetch ?? (configuration.provider === "gemini"
      ? createGeminiCompatibleFetch(createApplicationAiFetch([configuration.models.embedding]))
      : createApplicationAiFetch([configuration.models.embedding])),
  });
}
