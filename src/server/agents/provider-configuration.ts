export type AgentProviderName = "deterministic" | "openai" | "gemini";

export interface HostedModelConfiguration {
  memory: string;
  synthesis: string;
  safety: string;
  recovery: string;
  embedding: string;
}

export type ProviderConfiguration =
  | {
      provider: "deterministic";
      ready: true;
    }
  | {
      provider: "openai" | "gemini";
      ready: boolean;
      apiKey: string | undefined;
      baseURL: string | undefined;
      useResponses: boolean;
      models: HostedModelConfiguration;
      embeddingDimensions: 1536;
    };

export function resolveProviderConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): ProviderConfiguration {
  const provider = environment.AGENT_PROVIDER || "deterministic";
  if (provider === "deterministic") return { provider, ready: true };

  if (provider === "openai") {
    const apiKey = environment.OPENAI_API_KEY;
    return {
      provider,
      ready: Boolean(apiKey),
      apiKey,
      baseURL: environment.OPENAI_BASE_URL || undefined,
      useResponses: true,
      models: {
        memory: environment.OPENAI_MEMORY_MODEL ?? "gpt-5.6-luna",
        synthesis: environment.OPENAI_SYNTHESIS_MODEL ?? "gpt-5.6-terra",
        safety: environment.OPENAI_SAFETY_MODEL ?? "gpt-5.6-terra",
        recovery: environment.OPENAI_RECOVERY_MODEL ?? "gpt-5.6-terra",
        embedding: environment.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
      },
      embeddingDimensions: 1536,
    };
  }

  if (provider === "gemini") {
    const apiKey = environment.GEMINI_API_KEY;
    return {
      provider,
      ready: Boolean(apiKey),
      apiKey,
      baseURL: environment.GEMINI_BASE_URL
        ?? "https://generativelanguage.googleapis.com/v1beta/openai/",
      useResponses: false,
      models: {
        memory: environment.GEMINI_MEMORY_MODEL ?? "gemini-3.6-flash",
        synthesis: environment.GEMINI_SYNTHESIS_MODEL ?? "gemini-3.6-flash",
        safety: environment.GEMINI_SAFETY_MODEL ?? "gemini-3.6-flash",
        recovery: environment.GEMINI_RECOVERY_MODEL ?? "gemini-3.6-flash",
        embedding: environment.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001",
      },
      embeddingDimensions: 1536,
    };
  }

  throw new Error(
    `Unsupported AGENT_PROVIDER=${provider}; expected deterministic, openai, or gemini`,
  );
}
