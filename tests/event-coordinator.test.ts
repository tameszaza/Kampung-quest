import { describe, expect, it } from "vitest";
import type { QuestRun } from "@/server/domain/schemas";
import { EventCoordinator } from "@/server/features/event-coordinator";
import { expandAvailability, findClosestCommonAvailability, findCommonAvailability } from "@/server/features/availability-service";
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
  it("keeps an unconfirmed roster private until invitations are sent", async () => {
    const run = approvedRun();
    run.imageUrl = "/api/quest-images/generated-thumbnail";
    const store = new InMemoryKampungStore();
    await store.createQuestRun(run);
    const coordinator = new EventCoordinator({ store });

    const forming = await coordinator.createFormation(run);

    expect((await coordinator.listActivities("maria")).suggested).toEqual([
      expect.objectContaining({
        runId: run.runId,
        imageUrl: run.imageUrl,
      }),
    ]);
    expect((await coordinator.listActivities("anne")).suggested).toEqual([]);

    const confirmed = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "confirm-thumbnail-roster",
    });
    expect((await coordinator.listActivities("anne")).invitations).toEqual([
      expect.objectContaining({
        guestId: "anne",
        activity: expect.objectContaining({
          runId: run.runId,
          imageUrl: run.imageUrl,
        }),
      }),
    ]);
    expect(confirmed.invitations).toHaveLength(2);
  });

  it("chooses the compatible appointment nearest to the requested time", () => {
    const windows = [
      [
        { start: "2026-08-10T01:00:00.000Z", end: "2026-08-10T03:00:00.000Z" },
        { start: "2026-08-10T07:00:00.000Z", end: "2026-08-10T10:00:00.000Z" },
      ],
      [
        { start: "2026-08-10T02:00:00.000Z", end: "2026-08-10T03:00:00.000Z" },
        { start: "2026-08-10T08:00:00.000Z", end: "2026-08-10T11:00:00.000Z" },
      ],
    ];

    expect(findClosestCommonAvailability(windows, 60, "2026-08-10T07:30:00.000Z")).toEqual({
      start: "2026-08-10T08:00:00.000Z",
      end: "2026-08-10T09:00:00.000Z",
    });
  });

  it("publishes an undersized quest to the Suggested feed only after organizer consent", async () => {
    const run = approvedRun();
    run.proposal!.proposedParticipants = run.proposal!.proposedParticipants.slice(0, 2);
    run.proposal!.quest.groupSize = 2;
    run.validation = {
      valid: false,
      errors: [{ field: "groupSize", message: "This quest needs at least three people." }],
    };
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      resolveGroupSizeRange: async () => ({ minimum: 3, maximum: 5 }),
      assessRecruitmentCandidate: async (_state, userId) => userId === "sofia" ? { eligible: true, candidate: {
        participant: {
          candidateId: "sofia",
          proposedRole: "supporting_participant",
          needsAddressed: ["Would enjoy meeting neighbours"],
          contributionsUsed: ["can welcome newcomers"],
        },
        explanation: ["Compatible availability and group preferences"],
      } } : { eligible: false, discoverable: false, reason: "Not eligible", notices: [] },
    });

    const draft = await coordinator.createFormation(run);

    expect(draft.recruitment).toMatchObject({
      status: "draft",
      minimumGroupSize: 3,
      targetGroupSize: 3,
      maximumGroupSize: 5,
      publishedAt: null,
    });
    expect((await coordinator.listActivities("sofia")).suggested).toEqual([]);
    expect((await coordinator.listActivities("anne")).suggested).toEqual([]);
    await expect(coordinator.getStateForUser(draft.runId, "anne")).rejects.toThrow("not found");

    const published = await coordinator.publishRecruitment({
      runId: draft.runId,
      actorId: "maria",
      targetGroupSize: 4,
      expectedRevision: draft.revision,
      idempotencyKey: "publish-understaffed-quest",
    });

    expect(published.lifecycle).toBe("recruiting");
    expect(published.recruitment).toMatchObject({
      status: "open",
      minimumGroupSize: 3,
      targetGroupSize: 4,
      maximumGroupSize: 5,
    });
    expect((await coordinator.listActivities("sofia")).suggested).toEqual([
      expect.objectContaining({
        runId: run.runId,
        recruitment: expect.objectContaining({
          status: "open",
          currentApprovedCount: 2,
          minimumGroupSize: 3,
          targetGroupSize: 4,
          maximumGroupSize: 5,
        }),
      }),
    ]);
    expect((await coordinator.listActivities("unknown")).suggested).toEqual([]);
  });

  it("ranks eligible recruiting quests above discoverable mismatches", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      resolveGroupSizeRange: async () => ({ minimum: 3, maximum: 4 }),
      assessRecruitmentCandidate: async (state) => state.runId === "quest_joinable_match"
        ? { eligible: true, candidate: {
            participant: {
              candidateId: "sofia",
              proposedRole: "supporting_participant",
              needsAddressed: ["Would enjoy meeting neighbours"],
              contributionsUsed: ["can welcome newcomers"],
            },
            explanation: ["Eligible match"],
            score: 0,
          } }
        : {
            eligible: false,
            discoverable: true,
            reason: "Your availability does not include this quest's provisional time.",
            notices: ["Your availability does not include this quest's provisional time."],
          },
    });
    async function publish(runId: string) {
      const run = approvedRun();
      run.runId = runId;
      run.idempotencyKey = `formation-${runId}`;
      run.proposal!.proposedParticipants = run.proposal!.proposedParticipants.slice(0, 2);
      run.proposal!.quest.groupSize = 2;
      run.validation = { valid: false, errors: [{ field: "groupSize", message: "Three people are required." }] };
      const draft = await coordinator.createFormation(run);
      await coordinator.publishRecruitment({
        runId,
        actorId: "maria",
        targetGroupSize: 3,
        expectedRevision: draft.revision,
        idempotencyKey: `publish-${runId}`,
      });
    }
    await publish("quest_discoverable_mismatch");
    await publish("quest_joinable_match");

    expect((await coordinator.listActivities("sofia")).suggested.map((activity) => activity.runId)).toEqual([
      "quest_joinable_match",
      "quest_discoverable_mismatch",
    ]);
  });

  it("lets one viewer hide a recruiting suggestion without affecting anyone else", async () => {
    const run = approvedRun();
    run.proposal!.proposedParticipants = run.proposal!.proposedParticipants.slice(0, 2);
    run.proposal!.quest.groupSize = 2;
    run.validation = { valid: false, errors: [{ field: "groupSize", message: "Three people are required." }] };
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      resolveGroupSizeRange: async () => ({ minimum: 3, maximum: 4 }),
      assessRecruitmentCandidate: async (_state, userId) => ({ eligible: true, candidate: {
        participant: {
          candidateId: userId,
          proposedRole: "supporting_participant",
          needsAddressed: ["Would enjoy meeting neighbours"],
          contributionsUsed: ["can welcome newcomers"],
        },
        explanation: ["Eligible match"],
      } }),
    });
    const draft = await coordinator.createFormation(run);
    await coordinator.publishRecruitment({
      runId: draft.runId,
      actorId: "maria",
      targetGroupSize: 3,
      expectedRevision: draft.revision,
      idempotencyKey: "publish-hideable-suggestion",
    });

    expect((await coordinator.listActivities("sofia")).suggested.map((activity) => activity.runId)).toEqual([run.runId]);
    await expect(coordinator.hideSuggestion({ runId: run.runId, actorId: "maria" }))
      .rejects.toThrow("Only the recipient of an open recruiting suggestion can hide it");
    await coordinator.hideSuggestion({ runId: run.runId, actorId: "sofia" });

    expect((await coordinator.listActivities("sofia")).suggested).toEqual([]);
    expect((await coordinator.listActivities("noor")).suggested.map((activity) => activity.runId)).toEqual([run.runId]);
    await expect(coordinator.getStateForUser(run.runId, "sofia")).resolves.toMatchObject({ runId: run.runId });

    const current = (await coordinator.getStateForUser(run.runId, "noor"));
    await coordinator.requestToJoin({
      runId: run.runId,
      actorId: "noor",
      expectedRevision: current.revision,
      idempotencyKey: "noor-requests-before-hiding",
    });
    await coordinator.hideSuggestion({ runId: run.runId, actorId: "noor" });
    expect((await coordinator.listActivities("noor")).suggested).toEqual([]);
  });

  it("keeps join requests pending until organizer approval and closes at the target", async () => {
    const run = approvedRun();
    run.proposal!.proposedParticipants = run.proposal!.proposedParticipants.slice(0, 2);
    run.proposal!.quest.groupSize = 2;
    run.validation = { valid: false, errors: [{ field: "groupSize", message: "Three people are required." }] };
    const store = new InMemoryKampungStore();
    let sofiaEligible = true;
    const coordinator = new EventCoordinator({
      store,
      resolveGroupSizeRange: async () => ({ minimum: 3, maximum: 4 }),
      resolveMember: async (userId) => userId === "sofia"
        ? { displayName: "Sofia Tan", photoUrl: null }
        : null,
      assessRecruitmentCandidate: async (_state, userId) => userId === "sofia" && sofiaEligible ? { eligible: true, candidate: {
        participant: {
          candidateId: "sofia",
          proposedRole: "welcomer",
          needsAddressed: ["Would enjoy meeting neighbours"],
          contributionsUsed: ["can welcome newcomers"],
        },
        explanation: ["Compatible availability and group preferences"],
      } } : {
        eligible: false,
        discoverable: true,
        reason: "The applicant's availability no longer includes this quest window.",
        notices: ["The applicant's availability no longer includes this quest window."],
      },
      validateRoster: async (proposal) => proposal.proposedParticipants.length >= 3
        ? { valid: true, errors: [] }
        : { valid: false, errors: [{ field: "groupSize", message: "Three people are required." }] },
    });
    const draft = await coordinator.createFormation(run);
    const published = await coordinator.publishRecruitment({
      runId: draft.runId,
      actorId: "maria",
      targetGroupSize: 3,
      expectedRevision: draft.revision,
      idempotencyKey: "publish-for-sofia",
    });

    const requested = await coordinator.requestToJoin({
      runId: published.runId,
      actorId: "sofia",
      expectedRevision: published.revision,
      idempotencyKey: "sofia-requests",
    });
    const withPrivateArrangement = await store.saveEventCoordinationState({
      ...requested,
      revision: requested.revision + 1,
      arrangements: [{
        arrangementId: "private-arrangement",
        version: 1,
        start: "2026-08-10T03:00:00.000Z",
        end: "2026-08-10T04:30:00.000Z",
        venueName: "Exact Private Venue",
        venueAddress: "Private address",
        venueStatus: "proposed",
        status: "proposed",
        materialChanges: [],
        confirmations: [{ userId: "anne", status: "pending", respondedAt: null }],
        createdAt: requested.updatedAt,
        updatedAt: requested.updatedAt,
      }],
    }, requested.revision);
    const applicantView = await coordinator.getStateForUser(requested.runId, "sofia");
    const organizerView = await coordinator.getStateForUser(requested.runId, "maria");

    expect(requested.roster.map((member) => member.userId)).toEqual(["maria", "anne"]);
    expect(applicantView.viewer.role).toBe("applicant");
    expect(applicantView.roster).toEqual([]);
    expect(applicantView.proposal.quest.needsAddressed).toEqual([]);
    expect(applicantView.arrangements).toEqual([]);
    expect(applicantView.joinRequests).toEqual([
      expect.objectContaining({ applicantId: "sofia", status: "pending" }),
    ]);
    expect(organizerView.applicantProfiles).toEqual([
      { userId: "sofia", displayName: "Sofia Tan", photoUrl: null },
    ]);

    sofiaEligible = false;
    expect((await coordinator.listActivities("sofia")).suggested).toEqual([
      expect.objectContaining({
        recruitment: expect.objectContaining({
          viewerRequestStatus: "pending",
          viewerEligibility: {
            canRequest: false,
            notices: ["The applicant's availability no longer includes this quest window."],
          },
        }),
      }),
    ]);
    await expect(coordinator.decideJoinRequest({
      runId: requested.runId,
      requestId: requested.joinRequests[0].requestId,
      actorId: "maria",
      decision: "approve",
      expectedRevision: withPrivateArrangement.revision,
      idempotencyKey: "maria-attempts-stale-sofia",
    })).rejects.toThrow("availability no longer includes");
    sofiaEligible = true;

    const approved = await coordinator.decideJoinRequest({
      runId: requested.runId,
      requestId: requested.joinRequests[0].requestId,
      actorId: "maria",
      decision: "approve",
      expectedRevision: withPrivateArrangement.revision,
      idempotencyKey: "maria-approves-sofia",
    });

    expect(approved.roster.at(-1)).toMatchObject({ userId: "sofia", source: "application" });
    expect(approved.joinRequests[0]).toMatchObject({ status: "approved", version: 2 });
    expect(approved.recruitment.status).toBe("closed");
    expect(approved.lifecycle).toBe("forming");
    expect(approved.auditEvents.at(-1)).toMatchObject({ type: "join_request_approved", newLifecycle: "forming" });
    expect((await coordinator.listActivities("unknown")).suggested).toEqual([]);
  });

  it("does not truncate eligible recruiting quests to the general activity scan limit", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      resolveGroupSizeRange: async () => ({ minimum: 3, maximum: 4 }),
      assessRecruitmentCandidate: async () => ({ eligible: true, candidate: {
        participant: {
          candidateId: "sofia",
          proposedRole: "supporting_participant",
          needsAddressed: ["Would enjoy meeting neighbours"],
          contributionsUsed: ["can welcome newcomers"],
        },
        explanation: ["Eligible match"],
      } }),
    });
    for (let index = 0; index < 51; index += 1) {
      const run = approvedRun();
      run.runId = `quest_recruiting_${index}`;
      run.idempotencyKey = `formation-${index}`;
      run.proposal!.proposedParticipants = run.proposal!.proposedParticipants.slice(0, 2);
      run.proposal!.quest.groupSize = 2;
      run.validation = { valid: false, errors: [{ field: "groupSize", message: "Three people are required." }] };
      const draft = await coordinator.createFormation(run);
      await coordinator.publishRecruitment({
        runId: run.runId,
        actorId: "maria",
        targetGroupSize: 3,
        expectedRevision: draft.revision,
        idempotencyKey: `publish-${index}`,
      });
    }

    expect((await coordinator.listActivities("sofia")).suggested).toHaveLength(51);
  });

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
      recruitmentEligibility: null,
    });
    expect(organizerView.invitations.every((invitation) => invitation.guestId !== "maria")).toBe(true);
  });

  it("returns privacy-safe participant progress for the coordination hub", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      resolveMember: async (userId) => userId === "anne"
        ? { displayName: "Anne", photoUrl: null }
        : null,
    });
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
      recruitmentEligibility: null,
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
      recruitmentEligibility: null,
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
      resolveMember: async (userId) => userId === "anne"
        ? { displayName: "Anne", photoUrl: null }
        : null,
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
    const coordinator = new EventCoordinator({
      store,
      resolveMember: async (userId) => ({
        id: userId,
        displayName: ({ maria: "Maria", anne: "Anne", david: "David" } as Record<string, string>)[userId] ?? "Community member",
        photoUrl: null,
      }),
    });
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
    expect(state.notifications).toContainEqual(expect.objectContaining({
      userId: "maria",
      title: "Anne confirmed the plan",
    }));
    expect(state.notifications).toContainEqual(expect.objectContaining({
      userId: "david",
      title: "Anne confirmed the plan",
    }));
    expect(state.groupThread?.messages).toContainEqual(expect.objectContaining({
      kind: "arrangement_card",
      body: expect.stringContaining("Anne confirmed appointment version"),
    }));
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
    expect(state.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: "anne", title: "Everyone confirmed the plan" }),
      expect.objectContaining({ userId: "david", title: "Everyone confirmed the plan" }),
    ]));
  });

  it("applies a compatible participant appointment change immediately and asks everyone to confirm", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      coordinate: async () => ({
        reply: "I moved the activity to 1:00 PM.",
        requirementPatch: {},
        intent: {
          type: "change_appointment",
          patch: {
            localTime: "13:00",
            durationMinutes: 60,
            venueName: "NTU Hall 15",
            venueAddress: "50 Nanyang Avenue",
          },
        },
      }),
      validateArrangement: async () => ({ valid: true, errors: [] }),
    });
    const forming = await coordinator.createFormation(approvedRun());
    let state = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "agentic-change-roster",
    });
    for (const guestId of ["anne", "david"]) {
      const invitation = state.invitations.find((candidate) => candidate.guestId === guestId)!;
      state = await coordinator.respondToInvitation({
        runId: state.runId,
        invitationId: invitation.invitationId,
        actorId: guestId,
        response: "accept",
        expectedRevision: state.revision,
        idempotencyKey: `agentic-change-${guestId}`,
      });
    }

    const thread = await coordinator.getCoordinationThread(state.runId, "anne");
    await coordinator.addCoordinationMessage({
      runId: state.runId,
      actorId: "anne",
      body: "Move it to 1 PM",
      clientMessageId: "agentic-change-message",
      expectedRevision: thread.revision,
    });

    const updated = await store.findEventCoordinationState(state.runId);
    const arrangement = updated!.arrangements.at(-1)!;
    expect(arrangement.start).toBe("2026-08-10T05:00:00.000Z");
    expect(arrangement.end).toBe("2026-08-10T06:00:00.000Z");
    expect(arrangement.venueName).toBe("NTU Hall 15");
    expect(arrangement.venueAddress).toBe("50 Nanyang Avenue");
    expect(arrangement.status).toBe("awaiting_participant_confirmation");
    expect(arrangement.confirmations).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: "maria", status: "pending" }),
      expect.objectContaining({ userId: "anne", status: "pending" }),
      expect.objectContaining({ userId: "david", status: "pending" }),
    ]));
    expect(updated!.lifecycle).toBe("awaiting_confirmation");
    expect(updated!.memberships.every((membership) => membership.status === "awaiting_confirmation")).toBe(true);
    expect(updated!.groupThread?.messages).toContainEqual(expect.objectContaining({
      kind: "change_card",
      role: "system",
    }));
  });

  it("keeps a private message when the hosted provider fails", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      coordinate: async () => {
        throw new Error("gemini provider unavailable: request failed");
      },
    });
    const forming = await coordinator.createFormation(approvedRun());
    const state = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "provider-failure-roster",
    });
    const thread = await coordinator.getCoordinationThread(state.runId, "maria");

    const updated = await coordinator.addCoordinationMessage({
      runId: state.runId,
      actorId: "maria",
      body: "Move it to 3 PM",
      clientMessageId: "provider-failure-message",
      expectedRevision: thread.revision,
    });

    expect(updated.messages).toContainEqual(expect.objectContaining({
      messageId: "provider-failure-message",
      body: "Move it to 3 PM",
      role: "participant",
    }));
    expect(updated.messages).toContainEqual(expect.objectContaining({
      role: "assistant",
      body: "I couldn't process that message right now. Your message was saved; please try asking Senior Quest again.",
    }));
    expect((await store.findEventCoordinationState(state.runId))?.threads
      .find((candidate) => candidate.userId === "maria")?.messages)
      .toContainEqual(expect.objectContaining({ messageId: "provider-failure-message" }));
  });

  it("keeps a group message when the hosted provider fails", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      coordinate: async () => {
        throw new Error("gemini provider unavailable: request failed");
      },
    });
    const forming = await coordinator.createFormation(approvedRun());
    let state = await coordinator.confirmRoster({
      runId: forming.runId,
      actorId: "maria",
      expectedRevision: forming.revision,
      idempotencyKey: "group-provider-failure-roster",
    });
    for (const guestId of ["anne", "david"]) {
      const invitation = state.invitations.find((candidate) => candidate.guestId === guestId)!;
      state = await coordinator.respondToInvitation({
        runId: state.runId,
        invitationId: invitation.invitationId,
        actorId: guestId,
        response: "accept",
        expectedRevision: state.revision,
        idempotencyKey: `group-provider-failure-${guestId}`,
      });
    }
    const group = await coordinator.getGroupCoordinationThread(state.runId, "maria");

    const updated = await coordinator.addGroupCoordinationMessage({
      runId: state.runId,
      actorId: "maria",
      body: "Should we meet at NTU Hall 15?",
      clientMessageId: "group-provider-failure-message",
      expectedRevision: group.revision,
    });

    expect(updated.messages).toContainEqual(expect.objectContaining({
      messageId: "group-provider-failure-message",
      body: "Should we meet at NTU Hall 15?",
      role: "participant",
    }));
    expect(updated.messages).toContainEqual(expect.objectContaining({
      role: "assistant",
      body: "I couldn't process that message right now. Your message was delivered to the group; please try asking Senior Quest again.",
    }));
    expect((await store.findEventCoordinationState(state.runId))?.groupThread?.messages)
      .toContainEqual(expect.objectContaining({ messageId: "group-provider-failure-message" }));
  });

  it("makes a group message durable before the hosted provider finishes", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      coordinate: () => new Promise(() => undefined),
    });
    const forming = await coordinator.createFormation(approvedRun());
    let state = await coordinator.confirmRoster({ runId: forming.runId, actorId: "maria", expectedRevision: forming.revision, idempotencyKey: "pending-provider-roster" });
    for (const guestId of ["anne", "david"]) {
      const invitation = state.invitations.find((candidate) => candidate.guestId === guestId)!;
      state = await coordinator.respondToInvitation({ runId: state.runId, invitationId: invitation.invitationId, actorId: guestId, response: "accept", expectedRevision: state.revision, idempotencyKey: `pending-provider-${guestId}` });
    }
    const group = await coordinator.getGroupCoordinationThread(state.runId, "maria");

    void coordinator.addGroupCoordinationMessage({
      runId: state.runId,
      actorId: "maria",
      body: "Should we meet at NTU Hall 15?",
      clientMessageId: "pending-provider-message",
      expectedRevision: group.revision,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await store.findEventCoordinationState(state.runId))?.groupThread?.messages)
      .toContainEqual(expect.objectContaining({ messageId: "pending-provider-message" }));
  });

  it("keeps the agent reply when quest state changes while the provider is running", async () => {
    const store = new InMemoryKampungStore();
    let finishCoordination!: (output: { reply: string; requirementPatch: Record<string, never> }) => void;
    const coordinator = new EventCoordinator({
      store,
      coordinate: () => new Promise((resolve) => {
        finishCoordination = resolve;
      }),
    });
    const forming = await coordinator.createFormation(approvedRun());
    let state = await coordinator.confirmRoster({ runId: forming.runId, actorId: "maria", expectedRevision: forming.revision, idempotencyKey: "concurrent-agent-roster" });
    for (const guestId of ["anne", "david"]) {
      const invitation = state.invitations.find((candidate) => candidate.guestId === guestId)!;
      state = await coordinator.respondToInvitation({ runId: state.runId, invitationId: invitation.invitationId, actorId: guestId, response: "accept", expectedRevision: state.revision, idempotencyKey: `concurrent-agent-${guestId}` });
    }
    const group = await coordinator.getGroupCoordinationThread(state.runId, "maria");

    const sending = coordinator.addGroupCoordinationMessage({
      runId: state.runId,
      actorId: "maria",
      body: "Should we meet at NTU Hall 15?",
      clientMessageId: "concurrent-agent-message",
      expectedRevision: group.revision,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const accepted = (await store.findEventCoordinationState(state.runId))!;
    await store.saveEventCoordinationState({
      ...accepted,
      revision: accepted.revision + 1,
      updatedAt: new Date().toISOString(),
    }, accepted.revision);
    finishCoordination({ reply: "NTU Hall 15 could work for the group.", requirementPatch: {} });

    const updated = await sending;
    expect(updated.messages).toContainEqual(expect.objectContaining({
      role: "assistant",
      body: "NTU Hall 15 could work for the group.",
    }));
    expect((await store.findEventCoordinationState(state.runId))?.groupThread?.messages)
      .toContainEqual(expect.objectContaining({ body: "NTU Hall 15 could work for the group." }));
  });

  it("answers a premature agent confirmation instead of dropping the reply", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      coordinate: async () => ({
        reply: "Great, let's confirm NTU Hall 15 as the meeting point.",
        requirementPatch: {},
        intent: { type: "confirm_appointment", appointmentVersion: null },
      }),
    });
    const forming = await coordinator.createFormation(approvedRun());
    let state = await coordinator.confirmRoster({ runId: forming.runId, actorId: "maria", expectedRevision: forming.revision, idempotencyKey: "premature-confirm-roster" });
    for (const guestId of ["anne", "david"]) {
      const invitation = state.invitations.find((candidate) => candidate.guestId === guestId)!;
      state = await coordinator.respondToInvitation({ runId: state.runId, invitationId: invitation.invitationId, actorId: guestId, response: "accept", expectedRevision: state.revision, idempotencyKey: `premature-confirm-${guestId}` });
    }
    const group = await coordinator.getGroupCoordinationThread(state.runId, "maria");

    const updated = await coordinator.addGroupCoordinationMessage({
      runId: state.runId,
      actorId: "maria",
      body: "Yeah, Hall 15 NTU is sensible for me.",
      clientMessageId: "premature-confirm-message",
      expectedRevision: group.revision,
    });

    expect(updated.messages).toContainEqual(expect.objectContaining({
      role: "assistant",
      body: "There is no working appointment awaiting confirmation",
    }));
  });

  it("applies the same appointment actions from the shared group chat", async () => {
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      coordinate: async () => ({
        reply: "The group appointment is updated.",
        requirementPatch: {},
        intent: { type: "change_appointment", patch: { localTime: "14:00" } },
      }),
      validateArrangement: async () => ({ valid: true, errors: [] }),
    });
    const forming = await coordinator.createFormation(approvedRun());
    let state = await coordinator.confirmRoster({ runId: forming.runId, actorId: "maria", expectedRevision: forming.revision, idempotencyKey: "group-chat-roster" });
    for (const guestId of ["anne", "david"]) {
      const invitation = state.invitations.find((candidate) => candidate.guestId === guestId)!;
      state = await coordinator.respondToInvitation({ runId: state.runId, invitationId: invitation.invitationId, actorId: guestId, response: "accept", expectedRevision: state.revision, idempotencyKey: `group-chat-${guestId}` });
    }

    const group = await coordinator.getGroupCoordinationThread(state.runId, "david");
    await coordinator.addGroupCoordinationMessage({
      runId: state.runId,
      actorId: "david",
      body: "Could we move it to 2 PM?",
      clientMessageId: "group-change-message",
      expectedRevision: group.revision,
    });

    const updated = await store.findEventCoordinationState(state.runId);
    expect(updated!.arrangements.at(-1)).toMatchObject({
      start: "2026-08-10T06:00:00.000Z",
      end: "2026-08-10T07:30:00.000Z",
      status: "awaiting_participant_confirmation",
    });
    expect(updated!.groupThread?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: "group-change-message", senderId: "david", role: "participant" }),
      expect.objectContaining({ kind: "change_card", role: "assistant" }),
    ]));
  });

  it("finalizes only after natural-language confirmations from every active member", async () => {
    const run = approvedRun();
    run.proposal!.proposedParticipants = run.proposal!.proposedParticipants.slice(0, 2);
    run.proposal!.quest.groupSize = 2;
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      coordinate: async ({ message, state }) => message.toLowerCase().includes("confirm")
        ? {
            reply: "I will confirm the current version.",
            requirementPatch: {},
            intent: { type: "confirm_appointment", appointmentVersion: state.arrangements.at(-1)?.version ?? null },
          }
        : {
            reply: "I will update the working appointment.",
            requirementPatch: {},
            intent: { type: "change_appointment", patch: { localTime: "14:00" } },
          },
      validateArrangement: async () => ({ valid: true, errors: [] }),
    });
    const forming = await coordinator.createFormation(run);
    let state = await coordinator.confirmRoster({ runId: forming.runId, actorId: "maria", expectedRevision: forming.revision, idempotencyKey: "chat-confirm-roster" });
    state = await coordinator.respondToInvitation({
      runId: state.runId,
      invitationId: state.invitations[0].invitationId,
      actorId: "anne",
      response: "accept",
      expectedRevision: state.revision,
      idempotencyKey: "chat-confirm-anne-accepts",
    });
    let group = await coordinator.getGroupCoordinationThread(state.runId, "anne");
    group = await coordinator.addGroupCoordinationMessage({ runId: state.runId, actorId: "anne", body: "Move it to 2 PM", clientMessageId: "chat-confirm-change", expectedRevision: group.revision });
    await coordinator.addGroupCoordinationMessage({ runId: state.runId, actorId: "anne", body: "I confirm", clientMessageId: "chat-confirm-anne", expectedRevision: group.revision });
    expect((await store.findEventCoordinationState(state.runId))!.lifecycle).toBe("awaiting_confirmation");

    const organizerThread = await coordinator.getCoordinationThread(state.runId, "maria");
    await coordinator.addCoordinationMessage({ runId: state.runId, actorId: "maria", body: "I confirm", clientMessageId: "chat-confirm-maria", expectedRevision: organizerThread.revision });

    const finalized = await store.findEventCoordinationState(state.runId);
    expect(finalized!.lifecycle).toBe("scheduled");
    expect(finalized!.arrangements.at(-1)).toMatchObject({
      status: "finalized",
      confirmations: expect.arrayContaining([
        expect.objectContaining({ userId: "maria", status: "confirmed" }),
        expect.objectContaining({ userId: "anne", status: "confirmed" }),
      ]),
    });
    expect(finalized!.groupThread?.messages).toContainEqual(expect.objectContaining({
      kind: "arrangement_card",
      body: expect.stringContaining("final"),
    }));
  });

  it("keeps an incompatible request unapplied and offers a privacy-safe compromise", async () => {
    const run = approvedRun();
    run.proposal!.proposedParticipants = run.proposal!.proposedParticipants.slice(0, 2);
    run.proposal!.quest.groupSize = 2;
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      coordinate: async ({ message }) => ({
        reply: "I will check that option.",
        requirementPatch: {},
        intent: /use that/i.test(message)
          ? { type: "change_appointment", patch: {}, referencesSuggestionId: "latest" }
          : { type: "change_appointment", patch: { localTime: "14:00" } },
      }),
      validateArrangement: async ({ start }) => start === "2026-08-10T07:00:00.000Z"
        ? { valid: true, errors: [] }
        : { valid: false, errors: [{ field: "availability", message: "A private availability requirement conflicts." }] },
      suggestArrangement: async () => ({
        start: "2026-08-10T07:00:00.000Z",
        end: "2026-08-10T08:30:00.000Z",
        venueName: "Middle Ground Cafe",
        venueAddress: null,
      }),
    });
    const forming = await coordinator.createFormation(run);
    let state = await coordinator.confirmRoster({ runId: forming.runId, actorId: "maria", expectedRevision: forming.revision, idempotencyKey: "compromise-roster" });
    state = await coordinator.respondToInvitation({ runId: state.runId, invitationId: state.invitations[0].invitationId, actorId: "anne", response: "accept", expectedRevision: state.revision, idempotencyKey: "compromise-anne" });
    const thread = await coordinator.getCoordinationThread(state.runId, "anne");

    const result = await coordinator.addCoordinationMessage({
      runId: state.runId,
      actorId: "anne",
      body: "Move it to 2 PM",
      clientMessageId: "compromise-request",
      expectedRevision: thread.revision,
    });

    const updated = await store.findEventCoordinationState(state.runId);
    expect(updated!.arrangements).toEqual([]);
    expect(updated!.appointmentSuggestions).toContainEqual(expect.objectContaining({
      status: "offered",
      alternative: expect.objectContaining({ start: "2026-08-10T07:00:00.000Z", venueName: "Middle Ground Cafe" }),
    }));
    expect(result.messages.at(-1)).toMatchObject({
      kind: "text",
      body: expect.stringMatching(/does not work for the whole group.*3:00 pm.*Middle Ground Cafe/i),
    });
    expect(result.messages.at(-1)?.body).not.toContain("private availability");

    await coordinator.addCoordinationMessage({
      runId: state.runId,
      actorId: "anne",
      body: "Okay, use that option",
      clientMessageId: "compromise-accepted",
      expectedRevision: result.revision,
    });
    const accepted = await store.findEventCoordinationState(state.runId);
    expect(accepted!.arrangements.at(-1)).toMatchObject({
      start: "2026-08-10T07:00:00.000Z",
      venueName: "Middle Ground Cafe",
      status: "awaiting_participant_confirmation",
    });
    expect(accepted!.appointmentSuggestions.at(-1)?.status).toBe("accepted");
  });

  it("enforces organizer-only lifecycle actions from chat and executes authorized cancellation", async () => {
    const run = approvedRun();
    run.proposal!.proposedParticipants = run.proposal!.proposedParticipants.slice(0, 2);
    run.proposal!.quest.groupSize = 2;
    const store = new InMemoryKampungStore();
    const coordinator = new EventCoordinator({
      store,
      coordinate: async () => ({
        reply: "I will check that request.",
        requirementPatch: {},
        intent: { type: "organizer_action", action: "cancel" },
      }),
    });
    const forming = await coordinator.createFormation(run);
    let state = await coordinator.confirmRoster({ runId: forming.runId, actorId: "maria", expectedRevision: forming.revision, idempotencyKey: "chat-cancel-roster" });
    state = await coordinator.respondToInvitation({ runId: state.runId, invitationId: state.invitations[0].invitationId, actorId: "anne", response: "accept", expectedRevision: state.revision, idempotencyKey: "chat-cancel-anne" });
    let group = await coordinator.getGroupCoordinationThread(state.runId, "anne");

    group = await coordinator.addGroupCoordinationMessage({ runId: state.runId, actorId: "anne", body: "Cancel the activity", clientMessageId: "chat-cancel-denied", expectedRevision: group.revision });
    expect(group.messages.at(-1)?.body).toMatch(/only the organizer/i);
    expect((await store.findEventCoordinationState(state.runId))!.lifecycle).not.toBe("cancelled");

    await coordinator.addGroupCoordinationMessage({ runId: state.runId, actorId: "maria", body: "Cancel the activity", clientMessageId: "chat-cancel-approved", expectedRevision: group.revision });
    const cancelled = await store.findEventCoordinationState(state.runId);
    expect(cancelled!.lifecycle).toBe("cancelled");
    expect(cancelled!.memberships.every((membership) => membership.status === "cancelled")).toBe(true);
    expect(cancelled!.invitations.every((invitation) => invitation.status === "cancelled")).toBe(true);
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
    await expect(coordinator.getGroupCoordinationThread(invited.runId, "anne")).rejects.toThrow("not available");
    await expect(coordinator.addCoordinationMessage({ runId: invited.runId, actorId: "anne", body: "Before accepting", clientMessageId: "pending-message", expectedRevision: pendingThread.revision })).rejects.toThrow("not allowed");
    await expect(coordinator.getCoordinationThread(invited.runId, "outsider")).rejects.toThrow("cannot view");
    await expect(coordinator.getGroupCoordinationThread(invited.runId, "outsider")).rejects.toThrow("not available");
  });
});
