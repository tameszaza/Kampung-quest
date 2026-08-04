import type {
  EventCoordinationThread,
  EventQuestView,
  UserEventActivities,
} from "@/server/domain/event-coordination";
import type { ChatContact } from "@/server/identity/types";
import { createClientRequestId } from "@/lib/client-request-id";

async function json<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string; issues?: Array<{ message: string }> };
  if (!response.ok) throw new Error(payload.issues?.[0]?.message ?? payload.error ?? "Event coordination request failed");
  return payload;
}

export async function listEventActivities(): Promise<UserEventActivities> {
  return json(await fetch("/api/v1/activities", { cache: "no-store" }));
}

export async function getEventQuest(runId: string): Promise<EventQuestView | null> {
  const response = await fetch(`/api/v1/event-quests/${encodeURIComponent(runId)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  return json(response);
}

export async function updateEventRoster(input: {
  runId: string;
  action: "add" | "remove";
  userId: string;
  expectedRevision: number;
}): Promise<EventQuestView> {
  return json(await fetch(`/api/v1/event-quests/${encodeURIComponent(input.runId)}/roster`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export async function confirmEventRoster(runId: string, expectedRevision: number): Promise<EventQuestView> {
  return json(await fetch(`/api/v1/event-quests/${encodeURIComponent(runId)}/roster`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": createClientRequestId() },
    body: JSON.stringify({ expectedRevision }),
  }));
}

export async function publishEventRecruitment(input: {
  runId: string;
  targetGroupSize: number;
  expectedRevision: number;
}): Promise<EventQuestView> {
  return json(await fetch(`/api/v1/event-quests/${encodeURIComponent(input.runId)}/recruitment`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": createClientRequestId() },
    body: JSON.stringify({ targetGroupSize: input.targetGroupSize, expectedRevision: input.expectedRevision }),
  }));
}

export async function requestToJoinEventQuest(runId: string, expectedRevision: number): Promise<EventQuestView> {
  return json(await fetch(`/api/v1/event-quests/${encodeURIComponent(runId)}/join-requests`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": createClientRequestId() },
    body: JSON.stringify({ expectedRevision }),
  }));
}

export async function decideEventJoinRequest(input: {
  runId: string;
  requestId: string;
  decision: "approve" | "reject";
  expectedRevision: number;
}): Promise<EventQuestView> {
  return json(await fetch(
    `/api/v1/event-quests/${encodeURIComponent(input.runId)}/join-requests/${encodeURIComponent(input.requestId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": createClientRequestId() },
      body: JSON.stringify({ decision: input.decision, expectedRevision: input.expectedRevision }),
    },
  ));
}

export async function searchEventParticipants(runId: string, query: string): Promise<ChatContact[]> {
  const response = await fetch(
    `/api/v1/event-quests/${encodeURIComponent(runId)}/participants?q=${encodeURIComponent(query)}`,
    { cache: "no-store" },
  );
  return (await json<{ contacts: ChatContact[] }>(response)).contacts;
}

export async function respondToEventInvitation(input: {
  runId: string;
  invitationId: string;
  response: "accept" | "decline";
  expectedRevision: number;
}): Promise<EventQuestView> {
  return json(await fetch(`/api/v1/invitations/${encodeURIComponent(input.invitationId)}/respond`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": createClientRequestId() },
    body: JSON.stringify(input),
  }));
}

export async function transitionEventInvitation(input: {
  runId: string;
  invitationId: string;
  action: "expire" | "withdraw" | "replace" | "cancel";
  expectedRevision: number;
}): Promise<EventQuestView> {
  return json(await fetch(`/api/v1/invitations/${encodeURIComponent(input.invitationId)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": createClientRequestId() },
    body: JSON.stringify(input),
  }));
}

export async function transitionEventQuest(input: {
  runId: string;
  action: "cancel" | "start" | "complete" | "reopen";
  expectedRevision: number;
}): Promise<EventQuestView> {
  return json(await fetch(`/api/v1/event-quests/${encodeURIComponent(input.runId)}/lifecycle`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": createClientRequestId() },
    body: JSON.stringify({ action: input.action, expectedRevision: input.expectedRevision }),
  }));
}

export async function markEventNotificationsRead(runId?: string): Promise<number> {
  const response = await fetch("/api/v1/notifications/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId }),
  });
  return (await json<{ marked: number }>(response)).marked;
}

export async function getEventCoordinationThread(runId: string): Promise<EventCoordinationThread> {
  return json(await fetch(`/api/v1/event-quests/${encodeURIComponent(runId)}/coordination`, { cache: "no-store" }));
}

export async function sendEventCoordinationMessage(input: {
  runId: string;
  body: string;
  expectedRevision: number;
  clientMessageId?: string;
}): Promise<EventCoordinationThread> {
  return json(await fetch(`/api/v1/event-quests/${encodeURIComponent(input.runId)}/coordination`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      body: input.body,
      expectedRevision: input.expectedRevision,
      clientMessageId: input.clientMessageId ?? createClientRequestId(),
    }),
  }));
}

export async function confirmEventRequirements(runId: string, expectedRevision: number): Promise<EventCoordinationThread> {
  return json(await fetch(`/api/v1/event-quests/${encodeURIComponent(runId)}/coordination/requirements`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": createClientRequestId() },
    body: JSON.stringify({ expectedRevision }),
  }));
}

export async function proposeEventArrangement(input: {
  runId: string;
  start: string;
  end: string;
  venueName: string;
  venueAddress: string | null;
  expectedRevision: number;
}): Promise<EventQuestView> {
  return json(await fetch(`/api/v1/event-quests/${encodeURIComponent(input.runId)}/arrangements`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": createClientRequestId() },
    body: JSON.stringify(input),
  }));
}

export async function suggestEventArrangement(runId: string, expectedRevision: number): Promise<EventQuestView> {
  return json(await fetch(`/api/v1/event-quests/${encodeURIComponent(runId)}/arrangements`, {
    method: "PUT",
    headers: { "content-type": "application/json", "Idempotency-Key": createClientRequestId() },
    body: JSON.stringify({ expectedRevision }),
  }));
}

export async function decideEventArrangement(input: {
  runId: string;
  arrangementId: string;
  action: "approve" | "reject" | "confirm";
  expectedRevision: number;
}): Promise<EventQuestView> {
  return json(await fetch(
    `/api/v1/event-quests/${encodeURIComponent(input.runId)}/arrangements/${encodeURIComponent(input.arrangementId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": createClientRequestId() },
      body: JSON.stringify({ action: input.action, expectedRevision: input.expectedRevision }),
    },
  ));
}
