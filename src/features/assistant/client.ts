import type { AssistantRecommendationResult } from "@/server/features/assistant-recommendation-service";
import type {
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

export async function getMariaMemory(): Promise<MemoryCard | null> {
  const response = await fetch("/api/v1/memories/maria", { cache: "no-store" });
  if (response.status === 404) return null;
  return responseJson<MemoryCard>(response);
}

export async function listMariaQuests(limit = 20): Promise<QuestRun[]> {
  const response = await fetch(
    `/api/v1/quests?candidateId=maria&limit=${encodeURIComponent(limit)}`,
    { cache: "no-store" },
  );
  return responseJson<QuestRun[]>(response);
}

export async function getQuestRun(runId: string): Promise<QuestRun | null> {
  const response = await fetch(`/api/v1/quests/${encodeURIComponent(runId)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  return responseJson<QuestRun>(response);
}
