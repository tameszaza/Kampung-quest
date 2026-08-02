import type { CandidateEmbedding, MemoryAgentOutput } from "@/server/domain/schemas";
import OpenAI from "openai";

interface EmbedMemoryInput {
  candidateId: string;
  memoryVersion: number;
  memory: MemoryAgentOutput;
}

export interface EmbeddingProvider {
  embedMemory(input: EmbedMemoryInput): Promise<CandidateEmbedding[]>;
}

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly model = "deterministic-embedding-v1";

  async embedMemory(input: EmbedMemoryInput): Promise<CandidateEmbedding[]> {
    const sources = {
      need: input.memory.need,
      interest: input.memory.interests.join(" "),
      offer: input.memory.offers.join(" "),
    } as const;

    return Object.entries(sources).map(([kind, value]) => ({
      candidateId: input.candidateId,
      memoryVersion: input.memoryVersion,
      kind: kind as CandidateEmbedding["kind"],
      model: this.model,
      dimensions: 1536,
      vector: this.vector(value),
    }));
  }

  private vector(value: string): number[] {
    const vector = Array.from<number>({ length: 1536 }).fill(0);
    for (const [index, character] of [...value.toLowerCase()].entries()) {
      vector[index % vector.length] += character.codePointAt(0) ?? 0;
    }
    const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
    return vector.map((item) => item / magnitude);
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
  private readonly client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 2,
    timeout: 45_000,
  });

  async embedMemory(input: EmbedMemoryInput): Promise<CandidateEmbedding[]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: [input.memory.need, input.memory.interests.join(" "), input.memory.offers.join(" ")],
        encoding_format: "float",
      });
      const kinds: CandidateEmbedding["kind"][] = ["need", "interest", "offer"];
      return kinds.map((kind, index) => {
        const vector = response.data[index]?.embedding;
        if (!vector) throw new Error(`Embedding response is missing ${kind}`);
        return {
          candidateId: input.candidateId,
          memoryVersion: input.memoryVersion,
          kind,
          model: this.model,
          dimensions: vector.length,
          vector,
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown OpenAI error";
      throw new Error(`OpenAI embedding provider unavailable: ${message}`, { cause: error });
    }
  }
}
