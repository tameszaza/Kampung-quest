import type { AgentRuntime } from "@/server/agents/agent-runtime";
import type { EmbeddingProvider } from "@/server/agents/embedding-provider";

export class UnavailableAgentRuntime implements AgentRuntime {
  constructor(private readonly reason: string) {}

  conductConversation(): ReturnType<AgentRuntime["conductConversation"]> {
    return Promise.reject(new Error(this.reason));
  }

  updateMemory(): ReturnType<AgentRuntime["updateMemory"]> {
    return Promise.reject(new Error(this.reason));
  }

  synthesizeQuest(): ReturnType<AgentRuntime["synthesizeQuest"]> {
    return Promise.reject(new Error(this.reason));
  }

  reviewSafety(): ReturnType<AgentRuntime["reviewSafety"]> {
    return Promise.reject(new Error(this.reason));
  }

  recoverQuest(): ReturnType<AgentRuntime["recoverQuest"]> {
    return Promise.reject(new Error(this.reason));
  }

  coordinateEvent(): ReturnType<AgentRuntime["coordinateEvent"]> {
    return Promise.reject(new Error(this.reason));
  }
}

export class UnavailableEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly reason: string) {}

  embedMemory(): ReturnType<EmbeddingProvider["embedMemory"]> {
    return Promise.reject(new Error(this.reason));
  }
}
