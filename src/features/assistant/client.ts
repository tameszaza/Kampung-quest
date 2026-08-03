import type { AssistantRecommendationResult } from "@/server/features/assistant-recommendation-service";
import type {
  AssistantAnswer,
  AssistantConversationSnapshot,
  AssistantWorkflowEvent,
  AssistantRecommendationCommand,
  MemoryCard,
  QuestRun,
} from "@/server/domain/schemas";

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Senior Quest could not complete that request");
  return payload;
}

export async function requestRecommendation(
  command: AssistantRecommendationCommand,
): Promise<AssistantRecommendationResult> {
  const response = await fetch("/api/v1/assistant/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  return responseJson<AssistantRecommendationResult>(response);
}

export async function getUserMemory(): Promise<MemoryCard | null> {
  // The authenticated endpoint returns an explicit empty state (200 + null),
  // so a new member's needs page does not create a noisy, expected 404 request.
  const response = await fetch("/api/v1/memories", { cache: "no-store" });
  const payload = await responseJson<{ memory: MemoryCard | null }>(response);
  return payload.memory;
}

export async function listUserQuests(candidateId: string, limit = 20): Promise<QuestRun[]> {
  const response = await fetch(
    `/api/v1/quests?candidateId=${encodeURIComponent(candidateId)}&limit=${encodeURIComponent(limit)}`,
    { cache: "no-store" },
  );
  return responseJson<QuestRun[]>(response);
}

export async function getQuestRun(runId: string): Promise<QuestRun | null> {
  const response = await fetch(`/api/v1/quests/${encodeURIComponent(runId)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  return responseJson<QuestRun>(response);
}

export async function createAssistantConversation(candidateId: string): Promise<AssistantConversationSnapshot> {
  const response = await fetch("/api/v1/assistant/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateId }),
  });
  return responseJson<AssistantConversationSnapshot>(response);
}

export async function getAssistantConversation(
  conversationId: string,
): Promise<AssistantConversationSnapshot | null> {
  const response = await fetch(
    `/api/v1/assistant/conversations/${encodeURIComponent(conversationId)}`,
    { cache: "no-store" },
  );
  if (response.status === 404) return null;
  return responseJson<AssistantConversationSnapshot>(response);
}

export async function replayAssistantEvents(
  conversationId: string,
  afterSequence: number,
): Promise<AssistantWorkflowEvent[]> {
  const response = await fetch(
    `/api/v1/assistant/conversations/${encodeURIComponent(conversationId)}/events?after=${afterSequence}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Workflow events could not be restored" })) as { error?: string };
    throw new Error(payload.error ?? "Workflow events could not be restored");
  }
  const frames = (await response.text()).split("\n\n").filter(Boolean);
  return frames.flatMap((frame) => {
    const eventName = frame.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
    const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    return eventName === "stage" && data ? [JSON.parse(data) as AssistantWorkflowEvent] : [];
  });
}

export async function sendAssistantTurn(
  conversation: AssistantConversationSnapshot,
  answer: AssistantAnswer,
  clientTurnId = crypto.randomUUID(),
): Promise<AssistantConversationSnapshot> {
  const response = await fetch(
    `/api/v1/assistant/conversations/${encodeURIComponent(conversation.conversationId)}/turns`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientTurnId,
        revision: conversation.revision,
        answer,
      }),
    },
  );
  return responseJson<AssistantConversationSnapshot>(response);
}

export async function confirmAssistantConversation(
  conversation: AssistantConversationSnapshot,
  onStage: (event: AssistantWorkflowEvent) => void,
): Promise<AssistantConversationSnapshot> {
  const response = await fetch(
    `/api/v1/assistant/conversations/${encodeURIComponent(conversation.conversationId)}/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: conversation.revision }),
    },
  );
  if (!response.ok || !response.body) return responseJson<AssistantConversationSnapshot>(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: AssistantConversationSnapshot | null = null;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const eventName = frame.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
      const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (!data) continue;
      if (eventName === "stage") onStage(JSON.parse(data) as AssistantWorkflowEvent);
      if (eventName === "complete") completed = JSON.parse(data) as AssistantConversationSnapshot;
      if (eventName === "error") throw new Error((JSON.parse(data) as { error: string }).error);
    }
    if (done) break;
  }
  if (!completed) throw new Error("Senior Quest did not return a completed workflow");
  return completed;
}
