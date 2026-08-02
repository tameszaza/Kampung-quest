import { describe, expect, it } from "vitest";
import { HostedEmbeddingProvider } from "@/server/agents/embedding-provider";

function responseWithDimensions(dimensions: number): Response {
  return new Response(JSON.stringify({
    object: "list",
    data: [0, 1, 2].map((index) => ({
      object: "embedding",
      index,
      embedding: Array.from<number>({ length: dimensions }).fill(index + 1),
    })),
    model: "gemini-embedding-001",
    usage: { prompt_tokens: 3, total_tokens: 3 },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("HostedEmbeddingProvider", () => {
  it("sends a 1536-dimensional Gemini-compatible embedding request", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const provider = new HostedEmbeddingProvider({
      provider: "gemini",
      apiKey: "test-key",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      model: "gemini-embedding-001",
      dimensions: 1536,
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return responseWithDimensions(1536);
      },
    });

    const embeddings = await provider.embedMemory({
      candidateId: "candidate_001",
      memoryVersion: 1,
      memory: {
        markdown: "# Memory",
        need: "companionship",
        interests: ["cooking"],
        offers: ["teach a recipe"],
      },
    });

    expect(requestBody).toMatchObject({
      model: "gemini-embedding-001",
      dimensions: 1536,
      encoding_format: "float",
    });
    expect(requestBody?.input).toHaveLength(3);
    expect(embeddings).toHaveLength(3);
    expect(embeddings[0].model).toBe(
      "gemini:https://generativelanguage.googleapis.com/v1beta/openai/:gemini-embedding-001",
    );
    expect(embeddings[0].dimensions).toBe(1536);
  });

  it("rejects a provider response with the wrong vector dimensions", async () => {
    const provider = new HostedEmbeddingProvider({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-embedding-001",
      dimensions: 1536,
      fetch: async () => responseWithDimensions(768),
    });

    await expect(provider.embedMemory({
      candidateId: "candidate_001",
      memoryVersion: 1,
      memory: {
        markdown: "# Memory",
        need: "companionship",
        interests: ["cooking"],
        offers: ["teach a recipe"],
      },
    })).rejects.toThrow("has 768 dimensions; expected 1536");
  });
});
