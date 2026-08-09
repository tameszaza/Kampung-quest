import type { AssistantConversationStatus } from "@/server/domain/schemas";

export function showQuestFindingProgress(
  status: AssistantConversationStatus,
  workflowEventCount: number,
  confirming: boolean,
) {
  return confirming || (status === "processing" && workflowEventCount > 0);
}

export function showAssistantTurnThinking(
  status: AssistantConversationStatus,
  workflowEventCount: number,
  confirming: boolean,
  submitting: boolean,
) {
  return submitting || (status === "processing" && workflowEventCount === 0 && !confirming);
}
