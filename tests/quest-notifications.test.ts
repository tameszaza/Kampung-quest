import { describe, expect, it } from "vitest";
import type { QuestRun } from "@/server/domain/schemas";
import { buildQuestNotifications } from "@/server/quest/quest-notifications";

describe("quest activity notifications", () => {
  it("projects a pending suggestion without creating a chat-style match message", () => {
    const run = questRun("member-1", "member-2");
    run.participantProfiles = [
      { candidateId: "member-1", displayName: "Maria", photoUrl: null, proposedRole: "quest_host" },
      { candidateId: "member-2", displayName: "John", photoUrl: null, proposedRole: "discussion_leader" },
    ];

    const notifications = buildQuestNotifications([run], "member-2");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      kind: "suggested",
      title: "New activity suggestion",
      actor: { displayName: "Maria", role: "Quest host" },
    });
  });

  it("tells the initiator when another participant accepts", () => {
    const run = questRun("member-1", "member-2");
    run.coordination!.invitations[1].status = "accepted";
    run.participantProfiles = [
      { candidateId: "member-1", displayName: "Maria", photoUrl: null, proposedRole: "quest_host" },
      { candidateId: "member-2", displayName: "John", photoUrl: null, proposedRole: "discussion_leader" },
    ];

    const notifications = buildQuestNotifications([run], "member-1");
    expect(notifications).toHaveLength(1);
    expect(notifications[0].kind).toBe("joined");
    expect(notifications[0].message).toContain("John joined");
  });

  it("shows a no-match update only to the person who asked", () => {
    const run = questRun("member-1", "member-2");
    run.proposal = null;
    run.status = "no_match";

    expect(buildQuestNotifications([run], "member-1")[0].title).toBe("No match yet");
    expect(buildQuestNotifications([run], "member-2")).toEqual([]);
  });
});

function questRun(initiatorId: string, participantId: string): QuestRun {
  const now = "2026-08-04T08:00:00.000Z";
  return {
    runId: "quest-notification-test",
    initiatingCandidateId: initiatorId,
    idempotencyKey: null,
    status: "awaiting_acceptance",
    proposal: {
      quest: {
        title: "Neighbour Book Club",
        questType: "conversation",
        sharedGoal: "Meet neighbours",
        description: "A friendly conversation.",
        needsAddressed: ["companionship"],
        durationMinutes: 60,
        groupSize: 2,
        venueRequirements: ["step-free"],
        proposedTimeWindow: { start: "2026-08-05T03:00:00.000Z", end: "2026-08-05T04:00:00.000Z" },
      },
      proposedParticipants: [
        { candidateId: initiatorId, proposedRole: "quest_host", needsAddressed: [], contributionsUsed: [] },
        { candidateId: participantId, proposedRole: "discussion_leader", needsAddressed: [], contributionsUsed: [] },
      ],
      reserveCandidates: [],
      mutualBenefitExplanation: [],
      confidence: 0.9,
    },
    validation: { valid: true, errors: [] },
    safety: { status: "approved", riskLevel: "low", conditions: [], requiresHumanReview: false },
    coordination: {
      questId: "quest-notification-test",
      state: "awaiting_acceptance",
      invitations: [
        { candidateId: initiatorId, status: "pending" },
        { candidateId: participantId, status: "pending" },
      ],
      nextAction: "Await acceptance",
    },
    createdAt: now,
    updatedAt: now,
  };
}
