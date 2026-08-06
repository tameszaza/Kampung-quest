import type { AgentRuntime } from "@/server/agents/agent-runtime";
import type { EmbeddingProvider } from "@/server/agents/embedding-provider";

export class UnavailableAgentRuntime implements AgentRuntime {
  constructor(private readonly reason: string) {}

  private unavailable(): Error {
    return new Error(`agent provider unavailable: ${this.reason}`);
  }

  conductConversation(): ReturnType<AgentRuntime["conductConversation"]> {
    return Promise.reject(this.unavailable());
  }

  updateMemory(): ReturnType<AgentRuntime["updateMemory"]> {
    return Promise.reject(this.unavailable());
  }

  synthesizeQuest(): ReturnType<AgentRuntime["synthesizeQuest"]> {
    return Promise.reject(this.unavailable());
  }

  reviewSafety(): ReturnType<AgentRuntime["reviewSafety"]> {
    return Promise.reject(this.unavailable());
  }

  recoverQuest(): ReturnType<AgentRuntime["recoverQuest"]> {
    return Promise.reject(this.unavailable());
  }

  generateEventTaskPlan(): ReturnType<AgentRuntime["generateEventTaskPlan"]> {
    return Promise.reject(this.unavailable());
  }

  proposeEventTaskReassignment(): ReturnType<AgentRuntime["proposeEventTaskReassignment"]> {
    return Promise.reject(this.unavailable());
  }

  coordinateEvent(): ReturnType<AgentRuntime["coordinateEvent"]> {
    return Promise.reject(this.unavailable());
  }
}

export class UnavailableEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly reason: string) {}

  embedMemory(): ReturnType<EmbeddingProvider["embedMemory"]> {
    return Promise.reject(new Error(this.reason));
  }
}
