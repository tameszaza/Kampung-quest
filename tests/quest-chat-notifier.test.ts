import { describe, expect, it } from "vitest";
import type { QuestRun } from "@/server/domain/schemas";
import { InMemoryIdentityStore } from "@/server/identity/identity-store";
import { defaultPreferences } from "@/server/identity/types";
import { QuestChatNotifier } from "@/server/features/quest-chat-notifier";
import { InMemoryKampungStore } from "@/server/repositories/kampung-store";

function member(name: string, email: string) {
  return {
    fullName: name,
    username: name.toLowerCase().replaceAll(" ", "."),
    email,
    phone: null,
    passwordHash: "scrypt$test",
    dateOfBirth: null,
    gender: null,
    preferredLanguage: "English",
    area: "Nearby",
    photoUrl: `/assets/${name.toLowerCase().replaceAll(" ", "-")}.jpg`,
    preferences: structuredClone(defaultPreferences),
  };
}

function assistant(candidateId: string) {
  const now = new Date().toISOString();
  return {
    conversationId: `assistant-${candidateId}`,
    candidateId,
    status: "no_match" as const,
    revision: 1,
    messages: [{ messageId: `initial-${candidateId}`, role: "assistant" as const, content: "No match yet", createdAt: now }],
    brief: {},
    nextField: null,
    suggestedReplies: [],
    questRunId: null,
    events: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("quest chat notifications", () => {
  it("updates the assistant thread and sends a direct match message", async () => {
    const identity = new InMemoryIdentityStore();
    const store = new InMemoryKampungStore();
    const first = await identity.createUser(member("First Member", "first@example.com"));
    const second = await identity.createUser(member("Second Member", "second@example.com"));
    await store.createAssistantConversation(assistant(first.id));
    const notifier = new QuestChatNotifier(identity, store);
    const run = questRun(second.id, first.id);

    await notifier.questCreated(run);

    const updated = await store.findLatestAssistantConversation(first.id);
    expect(updated?.status).toBe("complete");
    expect(updated?.questRunId).toBe(run.runId);
    expect(updated?.messages.at(-1)?.content).toContain("Mystery Book Club");
    const direct = (await identity.listConversations(first.id)).find((conversation) => conversation.title === "Second Member");
    expect(direct).toBeTruthy();
    expect((await identity.listMessages(first.id, direct!.id)).at(-1)?.body).toContain("found a match");
  });

  it("announces a newly accepted participant to the other invitees", async () => {
    const identity = new InMemoryIdentityStore();
    const store = new InMemoryKampungStore();
    const first = await identity.createUser(member("First Member", "first-accept@example.com"));
    const second = await identity.createUser(member("Second Member", "second-accept@example.com"));
    await store.createAssistantConversation(assistant(second.id));
    const notifier = new QuestChatNotifier(identity, store);
    const run = questRun(first.id, second.id);
    await notifier.participantAccepted(run, second.id);

    const direct = (await identity.listConversations(first.id)).find((conversation) => conversation.title === "Second Member");
    expect((await identity.listMessages(first.id, direct!.id)).at(-1)?.body).toContain("accepted the role");
  });
});

function questRun(initiatorId: string, participantId: string): QuestRun {
  const now = new Date().toISOString();
  return {
    runId: "quest_notify_001",
    initiatingCandidateId: initiatorId,
    idempotencyKey: null,
    status: "awaiting_acceptance",
    proposal: {
      quest: {
        title: "Mystery Book Club",
        questType: "conversation",
        sharedGoal: "Share a good mystery",
        description: "A friendly book discussion.",
        needsAddressed: ["companionship"],
        durationMinutes: 60,
        groupSize: 2,
        venueRequirements: ["step-free"],
        proposedTimeWindow: { start: "2026-08-05T03:00:00.000Z", end: "2026-08-05T04:00:00.000Z" },
      },
      proposedParticipants: [
        { candidateId: initiatorId, proposedRole: "quest_host", needsAddressed: ["companionship"], contributionsUsed: ["welcome"] },
        { candidateId: participantId, proposedRole: "discussion_leader", needsAddressed: ["companionship"], contributionsUsed: ["stories"] },
      ],
      reserveCandidates: [],
      mutualBenefitExplanation: ["A good conversation"],
      confidence: 0.9,
    },
    validation: { valid: true, errors: [] },
    safety: { status: "approved", riskLevel: "low", conditions: [], requiresHumanReview: false },
    coordination: {
      questId: "quest_notify_001",
      state: "awaiting_acceptance",
      invitations: [{ candidateId: initiatorId, status: "pending" }, { candidateId: participantId, status: "pending" }],
      nextAction: "Await acceptance",
    },
    createdAt: now,
    updatedAt: now,
  };
}
