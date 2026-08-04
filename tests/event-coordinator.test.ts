import { describe, expect, it } from "vitest";
import type { QuestRun } from "@/server/domain/schemas";
import { EventCoordinator } from "@/server/features/event-coordinator";
import { expandAvailability, findCommonAvailability } from "@/server/features/availability-service";
import { InMemoryKampungStore } from "@/server/repositories/kampung-store";

function approvedRun(): QuestRun {
  const now = "2026-08-03T00:00:00.000Z";
  return {
    runId: "quest_event_coordinator",
    initiatingCandidateId: "maria",
    idempotencyKey: "formation-1",
    status: "forming",
    proposal: {
      quest: {
        title: "Healthy Lunch Together",
        questType: "community_activity",
        sharedGoal: "Enjoy a healthy lunch with neighbours.",
        description: "Prepare and share a healthy lunch in a public kitchen.",
        needsAddressed: ["Would like company for lunch"],
        durationMinutes: 90,
        groupSize: 3,
        venueRequirements: ["approved_public_location", "indoor"],
        proposedTimeWindow: {
          start: "2026-08-10T03:00:00.000Z",
          end: "2026-08-10T04:30:00.000Z",
        },
      },
      proposedParticipants: [
        {
          candidateId: "maria",
          proposedRole: "quest_host",
          needsAddressed: ["Would like company for lunch"],
          contributionsUsed: ["can bring fruit"],
        },
        {
          candidateId: "anne",
          proposedRole: "recipe_guide",
          needsAddressed: ["Would like to teach cooking"],
          contributionsUsed: ["can teach a recipe"],
        },
        {
          candidateId: "david",
          proposedRole: "welcomer",
          needsAddressed: ["Would like friendly company"],
          contributionsUsed: ["can welcome neighbours"],
        },
      ],
      reserveCandidates: [],
      mutualBenefitExplanation: ["Everyone contributes and receives company."],
      confidence: 0.84,
    },
    validation: { valid: true, errors: [] },
    safety: {
      status: "approved",
      riskLevel: "low",
      conditions: [],
      requiresHumanReview: false,
    },
    coordination: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("EventCoordinator", () => {
  it("keeps recommendations editable until the organizer confirms guest invitations", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({ store });

    const forming = await coordinator.createFormation(approvedRun());
    expect(forming.lifecycle).toBe("forming");
    expect(forming.invitations).toEqual([]);
    expect(forming.roster.map((member) => [member.userId, member.source])).toEqual([
      ["maria", "initiator"],
      ["anne", "recommended"],
      ["david", "recommended"],
    ]);

    const confirmed = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "confirm-roster-1",
    });
    const replayed = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "confirm-roster-1",
    });

    expect(confirmed.lifecycle).toBe("awaiting_responses");
    expect(confirmed.memberships).toContainEqual(expect.objectContaining({
      userId: "maria",
      role: "organizer",
      status: "coordinating",
    }));
    expect(confirmed.invitations.map((invitation) => [invitation.guestId, invitation.status])).toEqual([
      ["anne", "pending"],
      ["david", "pending"],
    ]);
    expect(confirmed.invitations.some((invitation) => invitation.guestId === "maria")).toBe(false);
    expect(replayed).toEqual(confirmed);
  });

  it("identifies the organizer without assigning a guest invitation", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({ store });
    const forming = await coordinator.createFormation(approvedRun());
    const confirmed = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "organizer-view",
    });

    const organizerView = await coordinator.getStateForUser(confirmed.runId, "maria");

    expect(organizerView.viewer).toEqual({
      role: "organizer",
      canChat: true,
      pendingInvitationId: null,
    });
    expect(organizerView.invitations.every((invitation) => invitation.guestId !== "maria")).toBe(true);
  });

  it("returns privacy-safe participant progress for the coordination hub", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({ store });
    const forming = await coordinator.createFormation(approvedRun());
    const confirmed = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "participant-progress",
    });

    const organizerView = await coordinator.getStateForUser(confirmed.runId, "maria");

    expect(organizerView.participantProgress).toEqual([
      expect.objectContaining({
        userId: "maria",
        invitationStatus: "organizer",
        membershipStatus: "coordinating",
        availabilityStatus: "not_shared",
      }),
      expect.objectContaining({
        userId: "anne",
        displayName: "Anne",
        invitationStatus: "pending",
        membershipStatus: null,
        availabilityStatus: "not_shared",
      }),
      expect.objectContaining({
        userId: "david",
        invitationStatus: "pending",
        membershipStatus: null,
        availabilityStatus: "not_shared",
      }),
    ]);
  });

  it("refreshes stale roster validation when profile availability changes", async () => {
    let profileAvailabilityFits = false;
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      resolveParticipant: async (userId) => ({
        participant: {
          candidateId: userId,
          proposedRole: "supporting_participant",
          needsAddressed: ["Would enjoy a community lunch"],
          contributionsUsed: ["can help prepare ingredients"],
        },
        explanation: ["Selected by you"],
      }),
      validateRoster: async () => profileAvailabilityFits
        ? { valid: true, errors: [] }
        : {
            valid: false,
            errors: [{
              candidateId: "sofia",
              field: "availability",
              message: "Proposed time is outside the participant's availability.",
            }],
          },
    });
    const forming = await coordinator.createFormation(approvedRun());
    const stale = await coordinator.updateRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      action: "add",
      userId: "sofia",
    });
    expect(stale.rosterValidation.valid).toBe(false);

    profileAvailabilityFits = true;
    const refreshed = await coordinator.getStateForUser(stale.runId, "maria");

    expect(refreshed.rosterValidation).toEqual({ valid: true, errors: [] });
  });

  it("expands recurring availability only inside the explicitly supplied horizon", () => {
    const windows = expandAvailability({
      explicitWindows: [{
        start: "2026-08-12T02:00:00.000Z",
        end: "2026-08-12T03:00:00.000Z",
      }],
      recurringRules: [{
        kind: "weekly_recurrence",
        daysOfWeek: [1, 2, 3, 4, 5],
        startLocalTime: "09:00",
        endLocalTime: "12:00",
        timeZone: "Asia/Singapore",
        validFrom: "2026-08-03",
        validUntil: "2026-08-09",
      }],
      horizon: { start: "2026-08-03", end: "2026-08-05" },
    });

    expect(windows).toEqual([
      { start: "2026-08-03T01:00:00.000Z", end: "2026-08-03T04:00:00.000Z" },
      { start: "2026-08-04T01:00:00.000Z", end: "2026-08-04T04:00:00.000Z" },
      { start: "2026-08-05T01:00:00.000Z", end: "2026-08-05T04:00:00.000Z" },
    ]);
  });

  it("finds the earliest overlap long enough for the quest", () => {
    expect(findCommonAvailability([
      [{ start: "2026-08-10T01:00:00.000Z", end: "2026-08-10T05:00:00.000Z" }],
      [{ start: "2026-08-10T02:00:00.000Z", end: "2026-08-10T04:00:00.000Z" }],
      [{ start: "2026-08-10T02:30:00.000Z", end: "2026-08-10T06:00:00.000Z" }],
    ], 90)).toEqual({
      start: "2026-08-10T02:30:00.000Z",
      end: "2026-08-10T04:00:00.000Z",
    });
  });

  it("moves only the accepting guest from Invited to Awaiting coordination", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({ store });
    const forming = await coordinator.createFormation(approvedRun());
    const confirmed = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "confirm-for-acceptance",
    });
    const anneInvitation = confirmed.invitations.find((invitation) => invitation.guestId === "anne")!;
    const pendingView = await coordinator.getStateForUser(confirmed.runId, "anne");
    expect(pendingView.viewer).toEqual({
      role: "pending_invitee",
      canChat: false,
      pendingInvitationId: anneInvitation.invitationId,
    });

    const accepted = await coordinator.respondToInvitation({
      runId: confirmed.runId,
      invitationId: anneInvitation.invitationId,
      actorId: "anne",
      response: "accept",
      expectedRevision: confirmed.revision,
      idempotencyKey: "anne-accepts",
    });
    const anneActivities = await coordinator.listActivities("anne");
    const davidActivities = await coordinator.listActivities("david");

    expect(accepted.invitations.find((invitation) => invitation.guestId === "anne")?.status).toBe("accepted");
    expect(accepted.memberships).toContainEqual(expect.objectContaining({
      userId: "anne",
      status: "coordinating",
    }));
    expect((await coordinator.getStateForUser(accepted.runId, "anne")).viewer).toEqual({
      role: "participant",
      canChat: true,
      pendingInvitationId: null,
    });
    expect(anneActivities.invitations).toEqual([]);
    expect(anneActivities.my.awaitingCoordination.map((activity) => activity.runId)).toEqual([confirmed.runId]);
    expect(davidActivities.invitations.map((invitation) => invitation.guestId)).toEqual(["david"]);
    expect(davidActivities.my.awaitingCoordination).toEqual([]);

    await expect(coordinator.respondToInvitation({
      runId: accepted.runId,
      invitationId: accepted.invitations.find((invitation) => invitation.guestId === "david")!.invitationId,
      actorId: "maria",
      response: "accept",
      expectedRevision: accepted.revision,
      idempotencyKey: "organizer-cannot-accept-for-david",
    })).rejects.toThrow("own invitation");
  });

  it("mixes manual and recommended people in one revalidated roster", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      resolveParticipant: async (userId) => userId === "sofia" ? {
        participant: {
          candidateId: "sofia",
          proposedRole: "supporting_participant",
          needsAddressed: ["Would enjoy tabletop games"],
          contributionsUsed: ["can teach a card game"],
        },
        explanation: ["Selected by you"],
      } : null,
      validateRoster: async (proposal) => ({
        valid: proposal.proposedParticipants.length <= 4,
        errors: proposal.proposedParticipants.length <= 4 ? [] : [{
          field: "groupSize",
          message: "This quest supports at most four people.",
        }],
      }),
    });
    const forming = await coordinator.createFormation(approvedRun());

    const mixed = await coordinator.updateRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      action: "add",
      userId: "sofia",
    });

    expect(mixed.roster.at(-1)).toMatchObject({ userId: "sofia", source: "manual" });
    expect(mixed.proposal.quest.groupSize).toBe(4);
    expect(mixed.rosterValidation.valid).toBe(true);
    await expect(coordinator.updateRoster({
      runId: mixed.runId,
      actorId: "maria",
      expectedRevision: mixed.revision,
      action: "add",
      userId: "sofia",
    })).rejects.toThrow("already in the roster");
  });

  it("keeps each invited guest's coordination conversation private", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      coordinate: async ({ message }) => ({
        reply: `I noted: ${message}`,
        requirementPatch: { temporaryConflicts: [message] },
      }),
    });
    const forming = await coordinator.createFormation(approvedRun());
    let confirmed = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "private-threads",
    });
    const anneInvitation = confirmed.invitations.find((invitation) => invitation.guestId === "anne")!;
    confirmed = await coordinator.respondToInvitation({
      runId: confirmed.runId,
      invitationId: anneInvitation.invitationId,
      actorId: "anne",
      response: "accept",
      expectedRevision: confirmed.revision,
      idempotencyKey: "anne-accepts-private-thread",
    });
    const anneThread = await coordinator.getCoordinationThread(confirmed.runId, "anne");

    await coordinator.addCoordinationMessage({
      runId: confirmed.runId,
      actorId: "anne",
      body: "I cannot make Tuesday afternoon",
      clientMessageId: "anne-conflict-1",
      expectedRevision: anneThread.revision,
    });

    const updatedAnne = await coordinator.getCoordinationThread(confirmed.runId, "anne");
    const davidThread = await coordinator.getCoordinationThread(confirmed.runId, "david");
    expect(updatedAnne.messages.map((message) => message.body)).toContain("I cannot make Tuesday afternoon");
    expect(updatedAnne.pendingRequirements?.temporaryConflicts).toEqual(["I cannot make Tuesday afternoon"]);
    expect(davidThread.messages.map((message) => message.body)).not.toContain("I cannot make Tuesday afternoon");
    expect((await coordinator.getStateForUser(confirmed.runId, "maria")).notifications
      .some((notification) => notification.kind === "availability_shared")).toBe(true);
    const anneView = await coordinator.getStateForUser(confirmed.runId, "anne");
    expect(anneView.threads.map((thread) => thread.userId)).toEqual(["anne"]);
    expect(anneView.notifications.every((notification) => notification.userId === "anne")).toBe(true);
    expect(anneView.outbox).toEqual([]);
    expect(anneView.auditEvents).toEqual([]);

    const requirements = await coordinator.confirmRequirements({
      runId: confirmed.runId,
      actorId: "anne",
      expectedRevision: updatedAnne.revision,
      idempotencyKey: "anne-confirms-conflict",
    });
    expect(requirements.pendingRequirements).toBeNull();
    expect(requirements.confirmedRequirements.temporaryConflicts).toEqual(["I cannot make Tuesday afternoon"]);
  });

  it("notifies the organizer when a guest shares availability without exposing private details", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      resolveMember: async (userId) => userId === "anne"
        ? { displayName: "Anne Tan", photoUrl: "/anne.jpg" }
        : null,
      coordinate: async () => ({
        reply: "I found an available time. Please save it if I understood correctly.",
        requirementPatch: {
          availableWindows: [{
            start: "2026-08-12T03:00:00.000Z",
            end: "2026-08-12T05:00:00.000Z",
          }],
        },
      }),
    });
    const forming = await coordinator.createFormation(approvedRun());
    let state = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "availability-alert-roster",
    });
    const invitation = state.invitations.find((candidate) => candidate.guestId === "anne")!;
    state = await coordinator.respondToInvitation({
      runId: state.runId,
      invitationId: invitation.invitationId,
      actorId: "anne",
      response: "accept",
      expectedRevision: state.revision,
      idempotencyKey: "availability-alert-accept",
    });
    const thread = await coordinator.getCoordinationThread(state.runId, "anne");

    await coordinator.addCoordinationMessage({
      runId: state.runId,
      actorId: "anne",
      body: "I am free after my appointment on Wednesday.",
      clientMessageId: "availability-alert-message",
      expectedRevision: thread.revision,
    });

    const organizerView = await coordinator.getStateForUser(state.runId, "maria");
    const alert = organizerView.notifications.find((notification) =>
      notification.kind === "availability_shared");
    expect(alert).toMatchObject({
      userId: "maria",
      title: "Anne Tan shared availability",
      body: "Availability is waiting for Anne Tan to confirm.",
    });
    expect(JSON.stringify(alert)).not.toContain("appointment");
    expect(JSON.stringify(alert)).not.toContain("2026-08-12");
    const stored = await store.findEventCoordinationState(state.runId);
    expect(stored?.outbox).toContainEqual(expect.objectContaining({
      kind: "notification",
      recipientId: "maria",
      deduplicationKey: alert?.deduplicationKey,
      status: "pending",
    }));
  });

  it("does not alert the organizer for ordinary chat without an availability patch", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      coordinate: async () => ({ reply: "I can help with that." }),
    });
    const forming = await coordinator.createFormation(approvedRun());
    let state = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "ordinary-chat-roster",
    });
    const invitation = state.invitations.find((candidate) => candidate.guestId === "anne")!;
    state = await coordinator.respondToInvitation({
      runId: state.runId,
      invitationId: invitation.invitationId,
      actorId: "anne",
      response: "accept",
      expectedRevision: state.revision,
      idempotencyKey: "ordinary-chat-accept",
    });
    const thread = await coordinator.getCoordinationThread(state.runId, "anne");
    await coordinator.addCoordinationMessage({
      runId: state.runId,
      actorId: "anne",
      body: "What should I bring?",
      clientMessageId: "ordinary-chat-message",
      expectedRevision: thread.revision,
    });

    expect((await coordinator.getStateForUser(state.runId, "maria")).notifications
      .some((item) => item.kind === "availability_shared")).toBe(false);
  });

  it("treats cleared windows and temporary conflicts as availability updates", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      coordinate: async () => ({
        reply: "Please save this availability update.",
        requirementPatch: { availableWindows: [], temporaryConflicts: ["Not available this week"] },
      }),
    });
    const forming = await coordinator.createFormation(approvedRun());
    let state = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "conflict-alert-roster",
    });
    const invitation = state.invitations.find((candidate) => candidate.guestId === "anne")!;
    state = await coordinator.respondToInvitation({
      runId: state.runId,
      invitationId: invitation.invitationId,
      actorId: "anne",
      response: "accept",
      expectedRevision: state.revision,
      idempotencyKey: "conflict-alert-accept",
    });
    const thread = await coordinator.getCoordinationThread(state.runId, "anne");

    await coordinator.addCoordinationMessage({
      runId: state.runId,
      actorId: "anne",
      body: "My availability changed.",
      clientMessageId: "conflict-alert-message",
      expectedRevision: thread.revision,
    });
    const pending = await coordinator.getCoordinationThread(state.runId, "anne");
    await coordinator.confirmRequirements({
      runId: state.runId,
      actorId: "anne",
      expectedRevision: pending.revision,
      idempotencyKey: "conflict-alert-confirm",
    });

    const organizerView = await coordinator.getStateForUser(state.runId, "maria");
    expect(organizerView.notifications.filter((item) => item.kind === "availability_shared")).toHaveLength(1);
    expect(organizerView.notifications.filter((item) => item.kind === "availability_confirmed")).toHaveLength(1);
    expect(organizerView.participantProgress.find((item) => item.userId === "anne")?.availabilityStatus).toBe("confirmed");
  });

  it("does not classify withdrawn guests as active participants", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({ store });
    const forming = await coordinator.createFormation(approvedRun());
    let state = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "withdrawn-view-roster",
    });
    const invitation = state.invitations.find((candidate) => candidate.guestId === "anne")!;
    state = await coordinator.respondToInvitation({
      runId: state.runId,
      invitationId: invitation.invitationId,
      actorId: "anne",
      response: "accept",
      expectedRevision: state.revision,
      idempotencyKey: "withdrawn-view-accept",
    });
    state = await coordinator.transitionInvitation({
      runId: state.runId,
      invitationId: invitation.invitationId,
      actorId: "anne",
      action: "withdraw",
      expectedRevision: state.revision,
      idempotencyKey: "withdrawn-view-withdraw",
    });

    await expect(coordinator.getStateForUser(state.runId, "anne")).rejects.toThrow("not found");
    expect((await coordinator.getStateForUser(state.runId, "maria")).participantProgress
      .find((item) => item.userId === "anne")?.membershipStatus).toBe("withdrawn");
  });

  it("notifies the organizer when a guest confirms availability and updates readiness", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      coordinate: async () => ({
        reply: "Please save this availability if it is correct.",
        requirementPatch: {
          availableWindows: [{
            start: "2026-08-12T03:00:00.000Z",
            end: "2026-08-12T05:00:00.000Z",
          }],
        },
      }),
    });
    const forming = await coordinator.createFormation(approvedRun());
    let state = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "availability-confirmed-roster",
    });
    const invitation = state.invitations.find((candidate) => candidate.guestId === "anne")!;
    state = await coordinator.respondToInvitation({
      runId: state.runId,
      invitationId: invitation.invitationId,
      actorId: "anne",
      response: "accept",
      expectedRevision: state.revision,
      idempotencyKey: "availability-confirmed-accept",
    });
    const thread = await coordinator.getCoordinationThread(state.runId, "anne");
    await coordinator.addCoordinationMessage({
      runId: state.runId,
      actorId: "anne",
      body: "Wednesday afternoon works for me.",
      clientMessageId: "availability-confirmed-message",
      expectedRevision: thread.revision,
    });
    const updatedThread = await coordinator.getCoordinationThread(state.runId, "anne");

    await coordinator.confirmRequirements({
      runId: state.runId,
      actorId: "anne",
      expectedRevision: updatedThread.revision,
      idempotencyKey: "availability-confirmed-requirements",
    });
    await coordinator.confirmRequirements({
      runId: state.runId,
      actorId: "anne",
      expectedRevision: updatedThread.revision,
      idempotencyKey: "availability-confirmed-requirements",
    });

    const organizerView = await coordinator.getStateForUser(state.runId, "maria");
    expect(organizerView.notifications).toContainEqual(expect.objectContaining({
      userId: "maria",
      kind: "availability_confirmed",
      title: "Anne confirmed availability",
    }));
    expect(organizerView.notifications.filter((item) => item.kind === "availability_confirmed")).toHaveLength(1);
    expect(organizerView.participantProgress.find((participant) => participant.userId === "anne"))
      .toMatchObject({ availabilityStatus: "confirmed" });
  });

  it("schedules only after organizer approval and every accepted guest confirms", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({ store });
    const forming = await coordinator.createFormation(approvedRun());
    let state = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "confirm-for-arrangement",
    });
    for (const guestId of ["anne", "david"]) {
      const invitation = state.invitations.find((candidate) => candidate.guestId === guestId)!;
      state = await coordinator.respondToInvitation({
        runId: state.runId,
        invitationId: invitation.invitationId,
        actorId: guestId,
        response: "accept",
        expectedRevision: state.revision,
        idempotencyKey: `${guestId}-accepts-arrangement-quest`,
      });
    }
    state = await coordinator.proposeArrangement({
      runId: state.runId,
      actorId: "maria",
      start: "2026-08-10T03:00:00.000Z",
      end: "2026-08-10T04:30:00.000Z",
      venueName: "Sunny Community Kitchen",
      venueAddress: "Public community centre",
      expectedRevision: state.revision,
      idempotencyKey: "arrangement-v1",
    });
    state = await coordinator.decideArrangement({
      runId: state.runId,
      arrangementId: state.arrangements.at(-1)!.arrangementId,
      actorId: "maria",
      action: "approve",
      expectedRevision: state.revision,
      idempotencyKey: "maria-approves-v1",
    });
    expect(state.lifecycle).toBe("awaiting_confirmation");

    state = await coordinator.decideArrangement({
      runId: state.runId,
      arrangementId: state.arrangements.at(-1)!.arrangementId,
      actorId: "anne",
      action: "confirm",
      expectedRevision: state.revision,
      idempotencyKey: "anne-confirms-v1",
    });
    expect(state.lifecycle).toBe("awaiting_confirmation");
    state = await coordinator.decideArrangement({
      runId: state.runId,
      arrangementId: state.arrangements.at(-1)!.arrangementId,
      actorId: "david",
      action: "confirm",
      expectedRevision: state.revision,
      idempotencyKey: "david-confirms-v1",
    });

    expect(state.lifecycle).toBe("scheduled");
    expect(state.arrangements.at(-1)?.status).toBe("finalized");
    expect(state.memberships.every((membership) => membership.status === "confirmed")).toBe(true);
  });

  it("preserves invitation history when a guest withdraws and returns an undersized quest to formation", async () => {
    const run = approvedRun();
    run.proposal!.proposedParticipants = run.proposal!.proposedParticipants.slice(0, 2);
    run.proposal!.quest.groupSize = 2;
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({ store });
    const forming = await coordinator.createFormation(run);
    let state = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "withdraw-roster",
    });
    const invitation = state.invitations[0];
    state = await coordinator.respondToInvitation({
      runId: state.runId,
      invitationId: invitation.invitationId,
      actorId: "anne",
      response: "accept",
      expectedRevision: state.revision,
      idempotencyKey: "anne-accepts-withdraw-quest",
    });
    state = await coordinator.transitionInvitation({
      runId: state.runId,
      invitationId: invitation.invitationId,
      actorId: "anne",
      action: "withdraw",
      expectedRevision: state.revision,
      idempotencyKey: "anne-withdraws",
    });

    expect(state.lifecycle).toBe("forming");
    expect(state.invitations[0]).toMatchObject({ status: "withdrawn", version: 3 });
    expect(state.memberships.find((membership) => membership.userId === "anne")?.status).toBe("withdrawn");
    expect(state.auditEvents.at(-1)?.type).toBe("invitation_withdrawn");
    await expect(coordinator.getCoordinationThread(state.runId, "anne")).rejects.toThrow("cannot view");
  });

  it("cancels active records atomically and emits deduplicated delivery work", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({ store });
    const forming = await coordinator.createFormation(approvedRun());
    const invited = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "cancel-roster",
    });
    expect(new Set(invited.outbox.map((job) => job.deduplicationKey)).size).toBe(invited.outbox.length);

    const cancelled = await coordinator.transitionQuest({
      runId: invited.runId,
      actorId: "maria",
      action: "cancel",
      expectedRevision: invited.revision,
      idempotencyKey: "cancel-quest",
    });
    const replay = await coordinator.transitionQuest({
      runId: invited.runId,
      actorId: "maria",
      action: "cancel",
      expectedRevision: invited.revision,
      idempotencyKey: "cancel-quest",
    });

    expect(cancelled.lifecycle).toBe("cancelled");
    expect(cancelled.invitations.every((invitation) => invitation.status === "cancelled")).toBe(true);
    expect(cancelled.memberships.every((membership) => membership.status === "cancelled")).toBe(true);
    expect(cancelled.outbox.filter((job) => job.kind === "invitation").every((job) => job.status === "cancelled")).toBe(true);
    expect(cancelled.outbox.some((job) => job.kind === "notification" && job.status === "pending")).toBe(true);
    expect(replay).toEqual(cancelled);
  });

  it("invalidates confirmations for material changes but keeps a minor duration revision scheduled", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({ store });
    const forming = await coordinator.createFormation(approvedRun());
    let state = await coordinator.confirmRoster({ runId: forming.runId, actorId: "maria", expectedRevision: forming.revision, idempotencyKey: "change-roster" });
    for (const guestId of ["anne", "david"]) {
      const invitation = state.invitations.find((candidate) => candidate.guestId === guestId)!;
      state = await coordinator.respondToInvitation({ runId: state.runId, invitationId: invitation.invitationId, actorId: guestId, response: "accept", expectedRevision: state.revision, idempotencyKey: `change-${guestId}` });
    }
    state = await coordinator.proposeArrangement({ runId: state.runId, actorId: "maria", start: "2026-08-10T03:00:00.000Z", end: "2026-08-10T04:30:00.000Z", venueName: "Community Kitchen", venueAddress: null, expectedRevision: state.revision, idempotencyKey: "change-v1" });
    state = await coordinator.decideArrangement({ runId: state.runId, arrangementId: state.arrangements.at(-1)!.arrangementId, actorId: "maria", action: "approve", expectedRevision: state.revision, idempotencyKey: "approve-change-v1" });
    for (const guestId of ["anne", "david"]) {
      state = await coordinator.decideArrangement({ runId: state.runId, arrangementId: state.arrangements.at(-1)!.arrangementId, actorId: guestId, action: "confirm", expectedRevision: state.revision, idempotencyKey: `confirm-change-${guestId}` });
    }

    state = await coordinator.proposeArrangement({ runId: state.runId, actorId: "maria", start: "2026-08-10T03:00:00.000Z", end: "2026-08-10T04:40:00.000Z", venueName: "Community Kitchen", venueAddress: null, expectedRevision: state.revision, idempotencyKey: "minor-v2" });
    expect(state.lifecycle).toBe("scheduled");
    expect(state.arrangements.at(-1)).toMatchObject({ status: "finalized", materialChanges: [] });

    state = await coordinator.proposeArrangement({ runId: state.runId, actorId: "maria", start: "2026-08-10T05:00:00.000Z", end: "2026-08-10T06:30:00.000Z", venueName: "Community Hall", venueAddress: null, expectedRevision: state.revision, idempotencyKey: "material-v3" });
    expect(state.lifecycle).toBe("coordinating");
    expect(state.arrangements.at(-1)?.materialChanges).toEqual(expect.arrayContaining(["date_or_time", "venue"]));
    expect(state.memberships.every((membership) => membership.status === "coordinating")).toBe(true);
  });

  it("tracks unread activity updates per recipient without exposing another participant's notifications", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({ store });
    const forming = await coordinator.createFormation(approvedRun());
    await coordinator.confirmRoster({ runId: forming.runId, actorId: "maria", expectedRevision: forming.revision, idempotencyKey: "unread-roster" });
    expect((await coordinator.listActivities("anne")).unreadCount).toBe(1);
    expect((await coordinator.listActivities("anne")).notifications).toEqual([
      expect.objectContaining({
        runId: forming.runId,
        userId: "anne",
        kind: "invitation",
      }),
    ]);
    expect((await coordinator.getStateForUser(forming.runId, "anne")).notifications).toHaveLength(1);
    expect((await coordinator.getStateForUser(forming.runId, "david")).notifications).toHaveLength(1);
    expect(await coordinator.markNotificationsRead({ actorId: "anne", runId: forming.runId })).toBe(1);
    expect((await coordinator.listActivities("anne")).unreadCount).toBe(0);
    expect((await coordinator.listActivities("david")).unreadCount).toBe(1);
  });

  it("enforces organizer, invitee, member, and outsider permissions independently", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({ store });
    const forming = await coordinator.createFormation(approvedRun());
    await expect(coordinator.getStateForUser(forming.runId, "outsider")).rejects.toThrow("not found");
    await expect(coordinator.updateRoster({ runId: forming.runId, actorId: "anne", expectedRevision: forming.revision, action: "remove", userId: "david" })).rejects.toThrow("Only the quest organizer");
    const invited = await coordinator.confirmRoster({ runId: forming.runId, actorId: "maria", expectedRevision: forming.revision, idempotencyKey: "permission-roster" });
    const pendingThread = await coordinator.getCoordinationThread(invited.runId, "anne");
    await expect(coordinator.addCoordinationMessage({ runId: invited.runId, actorId: "anne", body: "Before accepting", clientMessageId: "pending-message", expectedRevision: pendingThread.revision })).rejects.toThrow("not allowed");
    await expect(coordinator.getCoordinationThread(invited.runId, "outsider")).rejects.toThrow("cannot view");
  });
});
