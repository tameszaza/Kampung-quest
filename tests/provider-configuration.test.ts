import { describe, expect, it } from "vitest";
import { resolveProviderConfiguration } from "@/server/agents/provider-configuration";

describe("provider configuration", () => {
  it("keeps deterministic agents credential-free by default", () => {
    expect(resolveProviderConfiguration({})).toEqual({
      provider: "deterministic",
      ready: true,
    });
  });

  it("configures Gemini through the OpenAI-compatible Chat Completions endpoint", () => {
    expect(resolveProviderConfiguration({
      AGENT_PROVIDER: "gemini",
      GEMINI_API_KEY: "test-gemini-key",
    })).toEqual({
      provider: "gemini",
      ready: true,
      apiKey: "test-gemini-key",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      useResponses: false,
      models: {
        memory: "gemini-3.1-flash-lite",
        synthesis: "gemini-3.5-flash",
        safety: "gemini-3.1-flash-lite",
        recovery: "gemini-3.1-flash-lite",
        embedding: "gemini-embedding-001",
      },
      embeddingDimensions: 1536,
    });
  });

  it("supports Gemini model and endpoint overrides", () => {
    const configuration = resolveProviderConfiguration({
      AGENT_PROVIDER: "gemini",
      GEMINI_API_KEY: "key",
      GEMINI_BASE_URL: "https://example.test/openai/",
      GEMINI_MEMORY_MODEL: "memory-model",
      GEMINI_SYNTHESIS_MODEL: "synthesis-model",
      GEMINI_SAFETY_MODEL: "safety-model",
      GEMINI_RECOVERY_MODEL: "recovery-model",
      GEMINI_EMBEDDING_MODEL: "embedding-model",
    });

    expect(configuration).toMatchObject({
      baseURL: "https://example.test/openai/",
      models: {
        memory: "memory-model",
        synthesis: "synthesis-model",
        safety: "safety-model",
        recovery: "recovery-model",
        embedding: "embedding-model",
      },
    });
  });

  it("reports a hosted provider as unready when its key is absent", () => {
    expect(resolveProviderConfiguration({ AGENT_PROVIDER: "gemini" }).ready).toBe(false);
    expect(resolveProviderConfiguration({ AGENT_PROVIDER: "openai" }).ready).toBe(false);
  });

  it("rejects unknown providers instead of silently using deterministic agents", () => {
    expect(() => resolveProviderConfiguration({ AGENT_PROVIDER: "typo" })).toThrow(
      "Unsupported AGENT_PROVIDER",
    );
  });
});
