import { describe, expect, it, vi } from "vitest";
import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
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
  it("persists a generated task plan after a concurrent quest update", async () => {
    const { store, state } = await scheduledCoordinator();
    const superseded = await store.saveEventCoordinationState({
      ...state,
      revision: state.revision + 1,
      taskPlans: state.taskPlans.map((plan) => ({ ...plan, status: "superseded" as const })),
    }, state.revision);
    const deterministicAgent = new DeterministicAgentRuntime();
    let releaseGeneration: () => void = () => {};
    let signalGenerationStarted: () => void = () => {};
    const generationGate = new Promise<void>((resolve) => { releaseGeneration = resolve; });
    const generationStarted = new Promise<void>((resolve) => { signalGenerationStarted = resolve; });
    const coordinator = new EventCoordinator({
      store,
      generateTaskPlan: async (input) => {
        signalGenerationStarted();
        await generationGate;
        return deterministicAgent.generateEventTaskPlan(input);
      },
    });

    const generating = coordinator.ensureTaskPlan(superseded);
    await generationStarted;
    const pending = (await store.findEventCoordinationState(state.runId))!;
    await store.saveEventCoordinationState({
      ...pending,
      revision: pending.revision + 1,
      processedCommands: [...pending.processedCommands, "concurrent-update"],
      updatedAt: new Date().toISOString(),
    }, pending.revision);
    const saveState = store.saveEventCoordinationState.bind(store);
    let injectedConflicts = 0;
    store.saveEventCoordinationState = async (nextState, expectedRevision, eligibilityGuard) => {
      if (nextState.taskPlans.at(-1)?.status === "awaiting_acknowledgement"
        && injectedConflicts < 6) {
        const concurrent = (await store.findEventCoordinationState(state.runId))!;
        injectedConflicts += 1;
        await saveState({
          ...concurrent,
          revision: concurrent.revision + 1,
          processedCommands: [...concurrent.processedCommands, `conflict-${injectedConflicts}`],
          updatedAt: new Date().toISOString(),
        }, concurrent.revision);
      }
      return saveState(nextState, expectedRevision, eligibilityGuard);
    };
    releaseGeneration();

    const generated = await generating;
    const persisted = await store.findEventCoordinationState(state.runId);

    expect(generated.taskPlans.at(-1)?.status).toBe("awaiting_acknowledgement");
    expect(persisted?.taskPlans.at(-1)?.status).toBe("awaiting_acknowledgement");
    expect(persisted?.processedCommands).toContain("concurrent-update");
    expect(persisted?.processedCommands).toContain("conflict-6");
    expect(injectedConflicts).toBe(6);
  });

  it("persists task generation failure after a concurrent quest update", async () => {
    const { store, state } = await scheduledCoordinator();
    const superseded = await store.saveEventCoordinationState({
      ...state,
      revision: state.revision + 1,
      taskPlans: state.taskPlans.map((plan) => ({ ...plan, status: "superseded" as const })),
    }, state.revision);
    let releaseGeneration: () => void = () => {};
    let signalGenerationStarted: () => void = () => {};
    const generationGate = new Promise<void>((resolve) => { releaseGeneration = resolve; });
    const generationStarted = new Promise<void>((resolve) => { signalGenerationStarted = resolve; });
    const coordinator = new EventCoordinator({
      store,
      generateTaskPlan: async () => {
        signalGenerationStarted();
        await generationGate;
        throw new Error("Task provider failed");
      },
    });

    const generating = coordinator.ensureTaskPlan(superseded);
    await generationStarted;
    const pending = (await store.findEventCoordinationState(state.runId))!;
    await store.saveEventCoordinationState({
      ...pending,
      revision: pending.revision + 1,
      processedCommands: [...pending.processedCommands, "concurrent-failure-update"],
      updatedAt: new Date().toISOString(),
    }, pending.revision);
    releaseGeneration();

    const failed = await generating;

    expect(failed.taskPlans.at(-1)?.status).toBe("generation_failed");
    expect(failed.taskPlans.at(-1)?.generationError).toContain("Task provider failed");
    expect(failed.processedCommands).toContain("concurrent-failure-update");
  });

  it("marks an abandoned pending task plan as failed so it can be retried", async () => {
    const { store, coordinator, state } = await scheduledCoordinator();
    const latestPlan = state.taskPlans.at(-1)!;
    const abandonedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    const stuck = await store.saveEventCoordinationState({
      ...state,
      revision: state.revision + 1,
      taskPlans: state.taskPlans.map((plan) => plan.planId === latestPlan.planId
        ? {
            ...plan,
            status: "generation_pending" as const,
            roles: [],
            tasks: [],
            updatedAt: abandonedAt,
          }
        : plan),
      updatedAt: abandonedAt,
    }, state.revision);

    const recovered = await coordinator.ensureTaskPlan(stuck);

    expect(recovered.taskPlans.at(-1)?.status).toBe("generation_failed");
    expect(recovered.taskPlans.at(-1)?.generationError).toContain("interrupted");
  });

  it("times out task generation before pending-plan recovery can supersede it", async () => {
    const { store, state } = await scheduledCoordinator();
    const superseded = await store.saveEventCoordinationState({
      ...state,
      revision: state.revision + 1,
      taskPlans: state.taskPlans.map((plan) => ({ ...plan, status: "superseded" as const })),
    }, state.revision);
    const coordinator = new EventCoordinator({
      store,
      generateTaskPlan: () => new Promise(() => undefined),
    });
    vi.useFakeTimers();
    try {
      const generating = coordinator.ensureTaskPlan(superseded);
      await vi.advanceTimersByTimeAsync(2 * 60_000);

      const recovered = await generating;

      expect(recovered.taskPlans.at(-1)?.status).toBe("generation_failed");
      expect(recovered.taskPlans.at(-1)?.generationError).toContain("timed out");
    } finally {
      vi.useRealTimers();
    }
  });

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
