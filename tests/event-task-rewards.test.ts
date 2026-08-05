import { describe, expect, it } from "vitest";
import type { QuestRun } from "@/server/domain/schemas";
import { EventCoordinator } from "@/server/features/event-coordinator";
import { InMemoryKampungStore } from "@/server/repositories/kampung-store";
import { validateEventTaskPlan } from "@/server/domain/event-tasks";

function run(): QuestRun {
  const now = "2026-08-03T00:00:00.000Z";
  return {
    runId: "quest_task_rewards",
    initiatingCandidateId: "maria",
    idempotencyKey: "formation-task-rewards",
    status: "forming",
    proposal: {
      quest: {
        title: "Healthy Lunch Together",
        questType: "community_activity",
        sharedGoal: "Enjoy a healthy lunch with neighbours.",
        description: "Prepare and share a healthy lunch in a public kitchen.",
        needsAddressed: ["companionship"],
        durationMinutes: 90,
        groupSize: 3,
        venueRequirements: ["approved_public_location", "indoor"],
        proposedTimeWindow: {
          start: "2026-08-10T03:00:00.000Z",
          end: "2026-08-10T04:30:00.000Z",
        },
      },
      proposedParticipants: [
        { candidateId: "maria", proposedRole: "host", needsAddressed: ["companionship"], contributionsUsed: ["bring fruit"] },
        { candidateId: "anne", proposedRole: "recipe guide", needsAddressed: ["teaching"], contributionsUsed: ["teach a recipe"] },
        { candidateId: "david", proposedRole: "welcomer", needsAddressed: ["company"], contributionsUsed: ["welcome neighbours"] },
      ],
      reserveCandidates: [],
      mutualBenefitExplanation: ["Everyone contributes and receives company."],
      confidence: 0.9,
    },
    validation: { valid: true, errors: [] },
    safety: { status: "approved", riskLevel: "low", conditions: [], requiresHumanReview: false },
    coordination: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function scheduledCoordinator() {
  const store = new InMemoryKampungStore();
  const coordinator = new EventCoordinator({ store });
  let state = await coordinator.createFormation(run());
  state = await coordinator.confirmRoster({ runId: state.runId, actorId: "maria", expectedRevision: state.revision, idempotencyKey: "confirm-roster" });
  for (const userId of ["anne", "david"]) {
    const invitation = state.invitations.find((candidate) => candidate.guestId === userId)!;
    state = await coordinator.respondToInvitation({
      runId: state.runId,
      invitationId: invitation.invitationId,
      actorId: userId,
      response: "accept",
      expectedRevision: state.revision,
      idempotencyKey: `accept-${userId}`,
    });
  }
  state = await coordinator.proposeArrangement({
    runId: state.runId,
    actorId: "maria",
    start: "2026-08-10T03:00:00.000Z",
    end: "2026-08-10T04:30:00.000Z",
    venueName: "Sunny Community Kitchen",
    venueAddress: null,
    expectedRevision: state.revision,
    idempotencyKey: "arrangement-1",
  });
  const arrangement = state.arrangements.at(-1)!;
  state = await coordinator.decideArrangement({
    runId: state.runId,
    arrangementId: arrangement.arrangementId,
    actorId: "maria",
    action: "approve",
    expectedRevision: state.revision,
    idempotencyKey: "approve-arrangement",
  });
  for (const userId of ["anne", "david"]) {
    state = await coordinator.decideArrangement({
      runId: state.runId,
      arrangementId: arrangement.arrangementId,
      actorId: userId,
      action: "confirm",
      expectedRevision: state.revision,
      idempotencyKey: `confirm-arrangement-${userId}`,
    });
  }
  return { store, coordinator, state };
}

describe("event task rewards", () => {
  it("creates a small role-matched task plan only after everyone confirms", async () => {
    const { state } = await scheduledCoordinator();
    const plan = state.taskPlans.at(-1)!;

    expect(state.lifecycle).toBe("scheduled");
    expect(plan.status).toBe("awaiting_acknowledgement");
    expect(plan.roles).toHaveLength(3);
    expect(plan.tasks.length).toBeGreaterThanOrEqual(3);
    expect(plan.tasks.length).toBeLessThanOrEqual(5);
    expect(plan.tasks.every((task) => [10, 20, 30].includes(task.points))).toBe(true);
  });

  it("requires every role acknowledgement before a task can earn points", async () => {
    const { coordinator, state: initial } = await scheduledCoordinator();
    let state = initial;
    for (const userId of ["maria", "anne", "david"]) {
      state = await coordinator.respondToRole({
        runId: state.runId,
        actorId: userId,
        action: "acknowledge",
        expectedRevision: state.revision,
        idempotencyKey: `ack-role-${userId}`,
      });
    }
    const task = state.taskPlans.at(-1)!.tasks.find((candidate) => candidate.assignees.some((assignee) => assignee.userId === "maria"))!;
    expect(state.taskPlans.at(-1)!.status).toBe("active");
    state = await coordinator.actOnTask({
      runId: state.runId,
      taskId: task.taskId,
      actorId: "maria",
      action: "submit",
      expectedRevision: state.revision,
      idempotencyKey: "submit-maria-task",
    });
    state = await coordinator.actOnTask({
      runId: state.runId,
      taskId: task.taskId,
      actorId: "anne",
      action: "approve",
      expectedRevision: state.revision,
      idempotencyKey: "approve-maria-task",
    });

    expect(state.taskPlans.at(-1)!.tasks.find((candidate) => candidate.taskId === task.taskId)?.status).toBe("approved");
    expect(state.rewardEntries).toContainEqual(expect.objectContaining({
      userId: "maria",
      taskId: task.taskId,
      points: task.points,
      kind: "task_award",
    }));
  });

  it("rejects invalid plans that omit a participant or contain an arbitrary point value", () => {
    const errors = validateEventTaskPlan({
      roles: [{ userId: "maria", name: "Host", responsibility: "Help the group." }],
      tasks: [
        { title: "Bring fruit", instruction: "Bring fruit.", difficulty: "easy", assigneeIds: ["maria"] },
        { title: "Set up", instruction: "Set up.", difficulty: "hard", assigneeIds: ["maria"] },
        { title: "Welcome", instruction: "Welcome everyone.", difficulty: "medium", assigneeIds: ["maria"] },
      ],
    }, ["maria", "anne"], "maria");

    expect(errors).toEqual(expect.arrayContaining([
      "Every active participant needs exactly one final role",
      "Missing final role for anne",
      "Every active participant needs at least one task: anne",
    ]));
  });
});
