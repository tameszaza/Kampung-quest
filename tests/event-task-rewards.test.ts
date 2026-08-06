import { describe, expect, it, vi } from "vitest";
import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
import type { QuestRun } from "@/server/domain/schemas";
import { EventCoordinator } from "@/server/features/event-coordinator";
import { InMemoryKampungStore } from "@/server/repositories/kampung-store";
import { normalizeEventTaskPlanReviewers, validateEventTaskPlan } from "@/server/domain/event-tasks";

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

async function scheduledCoordinator(options: {
  questRun?: QuestRun;
  guestIds?: string[];
  generateTaskPlan?: ConstructorParameters<typeof EventCoordinator>[0]["generateTaskPlan"];
} = {}) {
  const store = new InMemoryKampungStore();
  const coordinator = new EventCoordinator({ store, generateTaskPlan: options.generateTaskPlan });
  const guestIds = options.guestIds ?? ["anne", "david"];
  let state = await coordinator.createFormation(options.questRun ?? run());
  state = await coordinator.confirmRoster({ runId: state.runId, actorId: "maria", expectedRevision: state.revision, idempotencyKey: "confirm-roster" });
  for (const userId of guestIds) {
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
  for (const userId of guestIds) {
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
  it("keeps an independent verifier when a two-person plan contains a joint organizer task", async () => {
    const questRun = run();
    if (!questRun.proposal) throw new Error("Test quest needs a proposal");
    questRun.proposal.quest.groupSize = 2;
    questRun.proposal.proposedParticipants = questRun.proposal.proposedParticipants.slice(0, 2);
    questRun.proposal.proposedParticipants = questRun.proposal.proposedParticipants.map((participant) => ({
      ...participant,
      proposedRole: "supporting_participant",
      contributionsUsed: ["   "],
    }));
    const { state } = await scheduledCoordinator({
      questRun,
      guestIds: ["anne"],
      generateTaskPlan: async () => ({
        roles: [
          { userId: "maria", name: "Host", responsibility: "Prepare the meal", mainContribution: "Bring fruit" },
          { userId: "anne", name: "Recipe guide", responsibility: "Guide the recipe", mainContribution: "Teach a recipe" },
        ],
        tasks: [
          { title: "Set up", instruction: "Prepare the event table.", roleUserId: "maria", difficulty: "easy", assigneeIds: ["maria", "anne"] },
          { title: "Guide recipe", instruction: "Explain the recipe steps.", roleUserId: "maria", difficulty: "medium", assigneeIds: ["maria", "anne"] },
          { title: "Cook together", instruction: "Prepare the meal together.", roleUserId: "maria", difficulty: "medium", assigneeIds: ["maria", "anne"] },
        ],
      }),
    });

    const plan = state.taskPlans.at(-1)!;

    expect(plan.status).toBe("awaiting_acknowledgement");
    expect(plan.tasks.every((task) => task.reviewerId !== task.roleUserId)).toBe(true);
    expect(["maria", "anne"].every((userId) => plan.tasks.some((task) =>
      task.assignees.some((assignee) => assignee.userId === userId)))).toBe(true);
  });

  it("uses a deterministic fallback when the task agent violates its output schema", async () => {
    const questRun = run();
    if (!questRun.proposal) throw new Error("Test quest needs a proposal");
    questRun.proposal.quest.groupSize = 2;
    questRun.proposal.proposedParticipants = questRun.proposal.proposedParticipants.slice(0, 2);

    const { state } = await scheduledCoordinator({
      questRun,
      guestIds: ["anne"],
      generateTaskPlan: async () => ({ roles: [], tasks: [] }) as never,
    });

    const plan = state.taskPlans.at(-1)!;

    expect(plan.status).toBe("awaiting_acknowledgement");
    expect(plan.roles).toHaveLength(2);
    expect(plan.tasks).toHaveLength(3);
  });

  it("normalizes organizer assignments while preserving each task's role owner", () => {
    const normalized = normalizeEventTaskPlanReviewers({
      roles: [
        { userId: "maria", name: "Host", responsibility: "Host the event" },
        { userId: "anne", name: "Guide", responsibility: "Guide the recipe" },
        { userId: "david", name: "Welcomer", responsibility: "Welcome everyone" },
      ],
      tasks: [
        { title: "Organizer task", instruction: "Set up together.", roleUserId: "maria", difficulty: "easy", assigneeIds: ["maria", "anne", "david"] },
        { title: "Guest task", instruction: "Cook together.", roleUserId: "anne", difficulty: "medium", assigneeIds: ["maria", "anne"] },
        { title: "Welcome", instruction: "Welcome the group.", roleUserId: "david", difficulty: "easy", assigneeIds: ["david"] },
      ],
    }, ["maria", "anne", "david"], "maria");

    expect(normalized.tasks[0]?.assigneeIds).toEqual(["maria", "david"]);
    expect(normalized.tasks[1]?.assigneeIds).toEqual(["maria", "anne"]);
    expect(validateEventTaskPlan(normalized, ["maria", "anne", "david"], "maria")).toEqual([]);
  });

  it("uses useful default task text for whitespace-only contributions", async () => {
    const output = await new DeterministicAgentRuntime().generateEventTaskPlan({
      organizerId: "maria",
      quest: { title: "Lunch", goal: "Share lunch", description: "Prepare lunch", durationMinutes: 60 },
      participants: [
        { userId: "maria", proposedRole: "host", contributions: ["   "], requirements: [] },
        { userId: "anne", proposedRole: "helper", contributions: ["   "], requirements: [] },
      ],
      appointment: { venueName: "Community centre" },
    });

    expect(output.tasks[0]?.instruction).toContain("Welcome everyone");
    expect(output.tasks[0]?.instruction).not.toMatch(/^\s*\./);
  });

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

  it("persists a deterministic fallback after task generation failure and a concurrent update", async () => {
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

    const recovered = await generating;

    expect(recovered.taskPlans.at(-1)?.status).toBe("awaiting_acknowledgement");
    expect(recovered.taskPlans.at(-1)?.generationError).toBeNull();
    expect(recovered.processedCommands).toContain("concurrent-failure-update");
    expect(recovered.auditEvents.at(-1)?.safeDiff).toEqual(expect.objectContaining({ fallbackUsed: true }));
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

  it("uses a deterministic fallback when task generation times out", async () => {
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

      expect(recovered.taskPlans.at(-1)?.status).toBe("awaiting_acknowledgement");
      expect(recovered.taskPlans.at(-1)?.generationError).toBeNull();
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

  it("keeps a completed event in every member's Completed activity list", async () => {
    const { coordinator, state: scheduled } = await scheduledCoordinator();
    const started = await coordinator.transitionQuest({
      runId: scheduled.runId,
      actorId: "maria",
      action: "start",
      expectedRevision: scheduled.revision,
      idempotencyKey: "start-completed-list-event",
    });
    const completed = await coordinator.transitionQuest({
      runId: started.runId,
      actorId: "maria",
      action: "complete",
      expectedRevision: started.revision,
      idempotencyKey: "complete-completed-list-event",
    });

    expect(completed.lifecycle).toBe("completed");
    for (const userId of ["maria", "anne", "david"]) {
      const activities = await coordinator.listActivities(userId);
      expect(activities.my.completed.map((activity) => activity.runId)).toContain(completed.runId);
      expect(activities.my.upcoming.map((activity) => activity.runId)).not.toContain(completed.runId);
      const detail = await coordinator.getStateForUser(completed.runId, userId);
      expect(detail.lifecycle).toBe("completed");
      if (userId !== "maria") expect(detail.viewer.canChat).toBe(false);
    }
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
