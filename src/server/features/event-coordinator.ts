import { createHash, randomUUID } from "node:crypto";
import type { Participant, QuestProposal, QuestRun, ValidationResult } from "@/server/domain/schemas";
import type {
  CoordinationRequirements,
  CoordinationIntent,
  EventArrangement,
  EventAppointmentSuggestion,
  EventActivityCard,
  EventCoordinationMessage,
  EventCoordinationThread,
  EventGroupCoordinationThread,
  EventCoordinationState,
  EventInvitation,
  EventJoinRequest,
  EventMembership,
  EventQuestView,
  EventRecruitmentAssessment,
  EventRecruitmentEligibilityGuard,
  EventRecruitmentViewerEligibility,
  UserEventActivities,
} from "@/server/domain/event-coordination";
import {
  eventTaskPlanAgentOutputSchema,
  normalizeEventTaskPlanReviewers,
  pointsForDifficulty,
  validateEventTaskPlan,
  type EventTask,
  type EventTaskPlan,
  type EventTaskPlanAgentInput,
  type EventTaskPlanAgentOutput,
  type EventTaskReassignmentAgentInput,
} from "@/server/domain/event-tasks";
import { logger, safeErrorMessage } from "@/server/observability/logger";

const TASK_PLAN_GENERATION_TIMEOUT_MS = 2 * 60_000;
const TASK_PLAN_GENERATION_STALE_MS = TASK_PLAN_GENERATION_TIMEOUT_MS + 60_000;

export interface EventCoordinationStore {
  createEventCoordinationState(state: EventCoordinationState): Promise<EventCoordinationState>;
  findEventCoordinationState(runId: string): Promise<EventCoordinationState | null>;
  saveEventCoordinationState(
    state: EventCoordinationState,
    expectedRevision: number,
    eligibilityGuard?: EventRecruitmentEligibilityGuard,
  ): Promise<EventCoordinationState>;
  listEventCoordinationStates(userId: string): Promise<EventCoordinationState[]>;
  listRecruitingEventCoordinationStates(): Promise<EventCoordinationState[]>;
  listHiddenEventSuggestionIds(userId: string): Promise<string[]>;
  hideEventSuggestion(userId: string, runId: string): Promise<void>;
  findQuestRun?(runId: string): Promise<QuestRun | null>;
  findQuestRuns?(runIds: string[]): Promise<QuestRun[]>;
  saveQuestRunWithFormation(
    run: QuestRun,
    state: EventCoordinationState,
    expectedUpdatedAt: string,
  ): Promise<QuestRun>;
}

interface EventCoordinatorDependencies {
  store: EventCoordinationStore;
  resolveMember?: (userId: string) => Promise<{
    displayName: string;
    photoUrl: string | null;
  } | null>;
  resolveParticipant?: (userId: string) => Promise<{
    participant: Participant;
    explanation: string[];
  } | null>;
  resolveGroupSizeRange?: (userIds: string[]) => Promise<{
    minimum: number;
    maximum: number;
  } | null>;
  assessRecruitmentCandidate?: (
    state: EventCoordinationState,
    userId: string,
  ) => Promise<EventRecruitmentAssessment>;
  validateRoster?: (proposal: QuestProposal) => Promise<ValidationResult>;
  validateArrangement?: (input: {
    state: EventCoordinationState;
    start: string;
    end: string;
    venueName: string;
  }) => Promise<ValidationResult>;
  suggestArrangement?: (state: EventCoordinationState, requested?: {
    start: string;
    end: string;
    venueName: string;
  }) => Promise<{
    start: string;
    end: string;
    venueName: string;
    venueAddress: string | null;
  } | null>;
  coordinate?: (input: {
    state: EventCoordinationState;
    thread: EventCoordinationThread;
    message: string;
    scope?: "private" | "group";
  }) => Promise<{
    reply: string;
    requirementPatch?: Partial<CoordinationRequirements>;
    intent?: CoordinationIntent;
  }>;
  generateTaskPlan?: (input: EventTaskPlanAgentInput) => Promise<EventTaskPlanAgentOutput>;
  proposeTaskReassignment?: (input: EventTaskReassignmentAgentInput) => Promise<{
    title: string;
    instruction: string;
    difficulty: EventTaskReassignmentAgentInput["task"]["difficulty"];
  }>;
}

export class EventCoordinator {
  constructor(private readonly dependencies: EventCoordinatorDependencies) {}

  async createFormation(run: QuestRun): Promise<EventCoordinationState> {
    if (!this.canEnterFormation(run)) {
      throw new Error("Only a validated and safety-approved proposal can enter formation");
    }
    const existing = await this.dependencies.store.findEventCoordinationState(run.runId);
    if (existing) return existing;
    return this.dependencies.store.createEventCoordinationState(await this.formationState(run));
  }

  async activateFormation(run: QuestRun, expectedUpdatedAt: string): Promise<QuestRun> {
    if (!this.canEnterFormation(run)) {
      throw new Error("Only a validated and safety-approved proposal can enter formation");
    }
    return this.dependencies.store.saveQuestRunWithFormation(run, await this.formationState(run), expectedUpdatedAt);
  }

  private async formationState(run: QuestRun): Promise<EventCoordinationState> {
    if (!run.proposal || !run.validation) throw new Error("Formation requires a proposal and validation result");
    const now = new Date().toISOString();
    const currentGroupSize = run.proposal.proposedParticipants.length;
    const resolvedRange = await this.dependencies.resolveGroupSizeRange?.(
      run.proposal.proposedParticipants.map((participant) => participant.candidateId),
    );
    if (resolvedRange && resolvedRange.minimum > resolvedRange.maximum) {
      throw new Error("The proposed participants do not share a compatible group-size range");
    }
    const minimumGroupSize = Math.max(2, resolvedRange?.minimum ?? currentGroupSize);
    const maximumGroupSize = resolvedRange?.maximum ?? Math.max(minimumGroupSize, currentGroupSize);
    const understaffed = currentGroupSize < minimumGroupSize;
    return {
      runId: run.runId,
      initiatorId: run.initiatingCandidateId,
      lifecycle: "forming",
      revision: 1,
      rosterRevision: 1,
      proposal: structuredClone(run.proposal),
      rosterValidation: structuredClone(run.validation),
      roster: run.proposal.proposedParticipants.map((participant) => ({
        userId: participant.candidateId,
        source: participant.candidateId === run.initiatingCandidateId ? "initiator" : "recommended",
        proposedRole: participant.proposedRole,
        explanation: participant.candidateId === run.initiatingCandidateId
          ? ["You started this quest"]
          : ["Compatible interests, contributions, and availability"],
      })),
      recruitment: {
        status: understaffed ? "draft" : "closed",
        minimumGroupSize,
        targetGroupSize: Math.max(minimumGroupSize, currentGroupSize),
        maximumGroupSize,
        publishedAt: null,
      },
      joinRequests: [],
      invitations: [],
      memberships: [],
      threads: [],
      groupThread: null,
      arrangements: [],
      taskPlans: [],
      rewardEntries: [],
      appointmentSuggestions: [],
      notifications: [],
      auditEvents: [{
        eventId: `event_${randomUUID()}`,
        type: "formation_created",
        actorId: run.initiatingCandidateId,
        aggregateRevision: 1,
        previousLifecycle: "forming",
        newLifecycle: "forming",
        idempotencyKey: run.idempotencyKey ?? null,
        safeDiff: { rosterSize: run.proposal.proposedParticipants.length },
        createdAt: now,
      }],
      outbox: [],
      processedCommands: [],
      timeZone: "Asia/Singapore",
      createdAt: now,
      updatedAt: now,
    };
  }

  async getStateForUser(runId: string, userId: string): Promise<EventQuestView> {
    let current = await this.requireState(runId);
    const organizer = current.initiatorId === userId;
    const pendingInvitation = [...current.invitations].reverse().find((invitation) =>
      invitation.guestId === userId && invitation.status === "pending");
    const activeMembership = [...current.memberships].reverse().find((membership) =>
      membership.userId === userId && this.isActiveMembership(membership));
    const terminalMembership = [...current.memberships].reverse().find((membership) =>
      membership.userId === userId && this.isTerminalMembership(membership));
    const hasInvitationHistory = current.invitations.some((invitation) => invitation.guestId === userId);
    const selectedMember = current.recruitment.status !== "draft"
      && current.roster.some((member) => member.userId === userId)
      && !hasInvitationHistory;
    const ownJoinRequest = [...current.joinRequests].reverse().find((request) => request.applicantId === userId);
    const ownJoinRequestGrantsAccess = ownJoinRequest?.status === "pending"
      || (ownJoinRequest?.status === "approved" && !hasInvitationHistory);
    const applicantAssessment = current.lifecycle === "recruiting" && current.recruitment.status === "open"
      ? await this.dependencies.assessRecruitmentCandidate?.(current, userId)
      : undefined;
    const eligibleApplicant = applicantAssessment?.eligible === true;
    const discoverableApplicant = eligibleApplicant
      || (applicantAssessment?.eligible === false && applicantAssessment.discoverable);
    if (!organizer && !pendingInvitation && !activeMembership && !terminalMembership && !selectedMember && !ownJoinRequestGrantsAccess && !discoverableApplicant) {
      throw new Error("Event coordination state was not found");
    }
    if (current.lifecycle === "scheduled" && this.canCoordinate(current, userId)) {
      current = await this.ensureTaskPlan(current);
    }
    const safe = structuredClone(current) as EventQuestView;
    const imageUrl = (await this.dependencies.store.findQuestRun?.(runId))?.imageUrl;
    if (imageUrl) safe.imageUrl = imageUrl;
    if (organizer && current.lifecycle === "forming") {
      safe.rosterValidation = this.dependencies.validateRoster
        ? await this.dependencies.validateRoster(current.proposal)
        : this.basicRosterValidation(current.proposal);
    }
    safe.viewer = {
      role: organizer ? "organizer" : pendingInvitation ? "pending_invitee" : activeMembership || terminalMembership ? "participant" : selectedMember ? "selected" : "applicant",
      canChat: this.canCoordinate(current, userId),
      pendingInvitationId: pendingInvitation?.invitationId ?? null,
      recruitmentEligibility: applicantAssessment?.eligible === true
        ? { canRequest: true, notices: [] }
        : applicantAssessment?.eligible === false && applicantAssessment.discoverable
          ? { canRequest: false, notices: applicantAssessment.notices }
          : null,
    };
    safe.participantProgress = await Promise.all(current.roster.map(async (rosterMember) => {
      const invitation = [...current.invitations].reverse().find((candidate) =>
        candidate.guestId === rosterMember.userId);
      const membership = [...current.memberships].reverse().find((candidate) =>
        candidate.userId === rosterMember.userId);
      const thread = current.threads.find((candidate) => candidate.userId === rosterMember.userId);
      const profile = await this.dependencies.resolveMember?.(rosterMember.userId);
      const hasPendingAvailability = this.hasAvailabilityUpdate(thread?.pendingRequirements);
      const hasConfirmedAvailability = Boolean(thread?.confirmedRequirements.availableWindows.length
        || thread?.confirmedRequirements.temporaryConflicts.length
        || current.auditEvents.some((event) => event.type === "requirements_confirmed"
          && event.actorId === rosterMember.userId
          && event.safeDiff.availabilityConfirmed === true));
      const availabilityStatus = hasPendingAvailability
        ? "awaiting_confirmation" as const
        : hasConfirmedAvailability ? "confirmed" as const : "not_shared" as const;
      return {
        userId: rosterMember.userId,
        displayName: profile?.displayName ?? this.displayMember(rosterMember.userId),
        photoUrl: profile?.photoUrl ?? null,
        invitationStatus: rosterMember.userId === current.initiatorId
          ? "organizer" as const
          : invitation?.status ?? "pending",
        membershipStatus: membership?.status ?? null,
        availabilityStatus,
        updatedAt: availabilityStatus === "not_shared" ? null : thread?.updatedAt ?? null,
      };
    }));
    safe.recruitmentProgress = { currentApprovedCount: current.roster.length };
    safe.applicantProfiles = await Promise.all((organizer
      ? current.joinRequests
      : current.joinRequests.filter((request) => request.applicantId === userId))
      .map(async (request) => {
        const profile = await this.dependencies.resolveMember?.(request.applicantId);
        return {
          userId: request.applicantId,
          displayName: profile?.displayName ?? this.displayMember(request.applicantId),
          photoUrl: profile?.photoUrl ?? null,
        };
      }));
    safe.threads = safe.threads.filter((thread) => thread.userId === userId);
    if (!organizer && !activeMembership) safe.groupThread = null;
    // Suggestions retain private source-message provenance internally. The
    // participant-facing chat already contains the privacy-safe alternative.
    safe.appointmentSuggestions = [];
    safe.notifications = safe.notifications.filter((notification) => notification.userId === userId);
    safe.auditEvents = [];
    safe.outbox = [];
    safe.processedCommands = [];
    safe.rewardEntries = safe.rewardEntries.filter((entry) => entry.userId === userId);
    safe.taskPlans = safe.taskPlans.map((plan) => ({
      ...plan,
      roles: plan.roles.map((role) => ({
        ...role,
        concern: organizer || role.userId === userId ? role.concern : null,
      })),
      tasks: plan.tasks.map((task) => ({
        ...task,
        reviewReason: organizer || task.reviewerId === userId || task.assignees.some((assignee) => assignee.userId === userId)
          ? task.reviewReason
          : null,
      })),
      reassignments: organizer
        ? plan.reassignments
        : plan.reassignments.filter((request) => request.requesterId === userId),
    }));
    if (!organizer) safe.invitations = safe.invitations.filter((invitation) => invitation.guestId === userId);
    if (!organizer) safe.joinRequests = safe.joinRequests.filter((request) => request.applicantId === userId);
    safe.proposal.quest.needsAddressed = [];
    safe.proposal.proposedParticipants = safe.proposal.proposedParticipants.map((participant) => ({
      ...participant,
      needsAddressed: [],
      contributionsUsed: [],
    }));
    if (safe.viewer.role === "applicant" || safe.viewer.role === "selected") {
      safe.initiatorId = "";
      safe.roster = [];
      safe.proposal.proposedParticipants = [];
      safe.proposal.reserveCandidates = [];
      safe.proposal.mutualBenefitExplanation = [];
      safe.participantProgress = [];
      safe.memberships = [];
      safe.invitations = [];
      safe.rosterValidation = { valid: true, errors: [] };
      safe.arrangements = [];
    }
    return safe;
  }

  async publishRecruitment(input: {
    runId: string;
    actorId: string;
    targetGroupSize: number;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.processedCommands.includes(input.idempotencyKey)) return current;
    if (current.initiatorId !== input.actorId) throw new Error("Only the quest organizer can publish recruitment");
    if (current.revision !== input.expectedRevision) throw new Error("Quest state conflict; reload and retry");
    if (current.lifecycle !== "forming" || current.recruitment.status !== "draft") {
      throw new Error("This quest is not available for recruitment publication");
    }
    if (input.targetGroupSize < current.recruitment.minimumGroupSize
      || input.targetGroupSize > current.recruitment.maximumGroupSize) {
      throw new Error("Target group size must be between the minimum and maximum group sizes");
    }
    if (current.roster.length >= input.targetGroupSize) throw new Error("This quest already meets its recruitment target");
    const now = new Date().toISOString();
    return this.dependencies.store.saveEventCoordinationState({
      ...current,
      lifecycle: "recruiting",
      revision: current.revision + 1,
      recruitment: {
        ...current.recruitment,
        status: "open",
        targetGroupSize: input.targetGroupSize,
        publishedAt: now,
      },
      auditEvents: [...current.auditEvents, this.auditEvent(current, "recruitment_published", input.actorId, input.idempotencyKey, {
        minimumGroupSize: current.recruitment.minimumGroupSize,
        targetGroupSize: input.targetGroupSize,
        maximumGroupSize: current.recruitment.maximumGroupSize,
        currentApprovedCount: current.roster.length,
      }, "recruiting")],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: now,
    }, current.revision);
  }

  async requestToJoin(input: {
    runId: string;
    actorId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.processedCommands.includes(input.idempotencyKey)) return current;
    if (current.revision !== input.expectedRevision) throw new Error("Quest state conflict; reload and retry");
    if (current.lifecycle !== "recruiting" || current.recruitment.status !== "open") {
      throw new Error("This quest is not accepting join requests");
    }
    if (current.roster.some((member) => member.userId === input.actorId)) {
      throw new Error("You are already in this quest roster");
    }
    if (current.roster.length >= current.recruitment.targetGroupSize) throw new Error("This quest has reached its target size");
    const previousRequest = [...current.joinRequests].reverse().find((request) => request.applicantId === input.actorId);
    if (previousRequest) {
      throw new Error(previousRequest.status === "pending"
        ? "You already have a pending request for this quest"
        : "Your request for this quest has already been decided");
    }
    const assessment = await this.dependencies.assessRecruitmentCandidate?.(current, input.actorId);
    if (!assessment?.eligible) {
      throw new Error(assessment?.discoverable
        ? assessment.reason
        : "You are not currently eligible for this quest");
    }
    const now = new Date().toISOString();
    const request: EventJoinRequest = {
      requestId: `join_request_${randomUUID()}`,
      runId: current.runId,
      applicantId: input.actorId,
      status: "pending",
      version: 1,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };
    return this.dependencies.store.saveEventCoordinationState({
      ...current,
      revision: current.revision + 1,
      joinRequests: [...current.joinRequests, request],
      auditEvents: [...current.auditEvents, this.auditEvent(current, "join_requested", input.actorId, input.idempotencyKey, {
        requestId: request.requestId,
      }, current.lifecycle)],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: now,
    }, current.revision);
  }

  async decideJoinRequest(input: {
    runId: string;
    requestId: string;
    actorId: string;
    decision: "approve" | "reject";
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.processedCommands.includes(input.idempotencyKey)) return current;
    if (current.initiatorId !== input.actorId) throw new Error("Only the quest organizer can decide join requests");
    if (current.revision !== input.expectedRevision) throw new Error("Quest state conflict; reload and retry");
    const request = current.joinRequests.find((candidate) => candidate.requestId === input.requestId);
    if (!request || request.status !== "pending") throw new Error("This join request is no longer pending");
    if (input.decision === "approve"
      && (current.lifecycle !== "recruiting" || current.recruitment.status !== "open")) {
      throw new Error("This quest is no longer recruiting");
    }
    const now = new Date().toISOString();
    let roster = current.roster;
    let proposal = current.proposal;
    let rosterValidation = current.rosterValidation;
    let lifecycle: EventCoordinationState["lifecycle"] = current.lifecycle;
    let recruitment = current.recruitment;
    let eligibilityGuard: EventRecruitmentEligibilityGuard | undefined;
    if (input.decision === "approve") {
      if (current.roster.length >= current.recruitment.targetGroupSize
        || current.roster.length >= current.recruitment.maximumGroupSize) {
        throw new Error("This quest has no remaining places");
      }
      const assessment = await this.dependencies.assessRecruitmentCandidate?.(current, request.applicantId);
      if (!assessment?.eligible) {
        throw new Error(assessment?.discoverable
          ? assessment.reason
          : "This applicant is no longer eligible for this quest");
      }
      const resolved = assessment.candidate;
      eligibilityGuard = resolved.eligibilityGuard;
      roster = [...current.roster, {
        userId: request.applicantId,
        source: "application",
        proposedRole: resolved.participant.proposedRole,
        explanation: resolved.explanation,
      }];
      const participants = [...current.proposal.proposedParticipants, resolved.participant];
      proposal = {
        ...structuredClone(current.proposal),
        quest: {
          ...current.proposal.quest,
          groupSize: participants.length,
          needsAddressed: [...new Set(participants.flatMap((participant) => participant.needsAddressed))],
        },
        proposedParticipants: participants,
      };
      rosterValidation = this.dependencies.validateRoster
        ? await this.dependencies.validateRoster(proposal)
        : this.basicRosterValidation(proposal);
      if (!rosterValidation.valid && !this.hasOnlyGroupSizeErrors(rosterValidation)) {
        throw new Error(rosterValidation.errors.map((error) => error.message).join(" ")
          || "This applicant is no longer eligible for this quest");
      }
      if (roster.length >= recruitment.targetGroupSize) {
        lifecycle = "forming";
        recruitment = { ...recruitment, status: "closed" };
      }
    }
    const targetReached = input.decision === "approve" && roster.length >= recruitment.targetGroupSize;
    const joinRequests = current.joinRequests.map((candidate): EventJoinRequest => {
      if (candidate.requestId === request.requestId) {
        return { ...candidate, status: input.decision === "approve" ? "approved" : "rejected", version: candidate.version + 1, updatedAt: now };
      }
      if (targetReached && candidate.status === "pending") {
        return { ...candidate, status: "rejected", version: candidate.version + 1, updatedAt: now };
      }
      return candidate;
    });
    return this.dependencies.store.saveEventCoordinationState({
      ...current,
      lifecycle,
      revision: current.revision + 1,
      rosterRevision: input.decision === "approve" ? current.rosterRevision + 1 : current.rosterRevision,
      roster,
      proposal,
      rosterValidation,
      recruitment,
      joinRequests,
      auditEvents: [...current.auditEvents, this.auditEvent(current, input.decision === "approve" ? "join_request_approved" : "join_request_rejected", input.actorId, input.idempotencyKey, {
        requestId: request.requestId,
        applicantId: request.applicantId,
        currentApprovedCount: roster.length,
        surplusRequestsClosed: targetReached
          ? current.joinRequests.filter((candidate) => candidate.requestId !== request.requestId && candidate.status === "pending").length
          : 0,
      }, lifecycle)],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: now,
    }, current.revision, eligibilityGuard);
  }

  async confirmRoster(input: {
    runId: string;
    actorId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.processedCommands.includes(input.idempotencyKey)) return current;
    if (current.initiatorId !== input.actorId) throw new Error("Only the quest organizer can confirm the roster");
    if (current.lifecycle !== "forming") throw new Error("This roster is not available for confirmation");
    if (current.revision !== input.expectedRevision) throw new Error("Quest state conflict; reload and retry");
    const ids = current.roster.map((member) => member.userId);
    if (ids.length < 2 || new Set(ids).size !== ids.length) {
      throw new Error("A confirmed roster requires at least two unique members");
    }
    if (!ids.includes(current.initiatorId)) throw new Error("The organizer must remain in the roster");
    const latestValidation = this.dependencies.validateRoster
      ? await this.dependencies.validateRoster(current.proposal)
      : this.basicRosterValidation(current.proposal);
    if (!latestValidation.valid) {
      throw new Error(latestValidation.errors.map((error) => error.message).join(" ")
        || "The complete roster must pass validation before confirmation");
    }

    const now = new Date().toISOString();
    const organizer = current.roster.find((member) => member.userId === current.initiatorId)!;
    const memberships: EventMembership[] = current.memberships.some((membership) =>
      membership.userId === current.initiatorId && !["withdrawn", "replaced", "cancelled"].includes(membership.status))
      ? current.memberships
      : [...current.memberships, {
          membershipId: `membership_${randomUUID()}`,
          runId: current.runId,
          userId: current.initiatorId,
          role: "organizer",
          rosterSource: organizer.source,
          status: "coordinating",
          joinedAt: now,
          updatedAt: now,
        }];
    const invitations: EventInvitation[] = current.roster
      .filter((member) => member.userId !== current.initiatorId)
      .filter((member) => !current.invitations.some((invitation) =>
        invitation.guestId === member.userId && ["pending", "accepted"].includes(invitation.status)))
      .map((member) => ({
        invitationId: `invitation_${randomUUID()}`,
        runId: current.runId,
        inviterId: current.initiatorId,
        guestId: member.userId,
        status: "pending" as const,
        version: 1,
        deliveryState: "pending",
        idempotencyKey: `${input.idempotencyKey}:${member.userId}`,
        rosterRevision: current.rosterRevision,
        createdAt: now,
        updatedAt: now,
      }));
    const threads: EventCoordinationThread[] = current.roster
      .filter((member) => !current.threads.some((thread) => thread.userId === member.userId))
      .map((member) => ({
      threadId: `coordination_${randomUUID()}`,
      runId: current.runId,
      userId: member.userId,
      revision: 1,
      messages: [{
        messageId: `message_${randomUUID()}`,
        role: "system",
        body: member.userId === current.initiatorId
          ? "Your group is ready for invitation responses and private coordination."
          : `You are invited to ${current.proposal.quest.title}. The displayed times are availability, not a confirmed schedule.`,
        kind: member.userId === current.initiatorId ? "text" : "invitation_card",
        createdAt: now,
      }],
      visibleAppointmentVersion: null,
      confirmedRequirements: this.emptyRequirements(),
      pendingRequirements: null,
      lastReadAt: null,
      updatedAt: now,
    }));
    const notifications = invitations.map((invitation) => ({
      notificationId: `notification_${randomUUID()}`,
      userId: invitation.guestId,
      kind: "invitation" as const,
      title: `Invitation: ${current.proposal.quest.title}`,
      body: "Review the provisional availability and respond when you are ready.",
      readAt: null,
      deduplicationKey: `invitation:${invitation.invitationId}`,
      createdAt: now,
    }));
    const groupThread: EventGroupCoordinationThread = current.groupThread ?? {
      threadId: `coordination_group_${randomUUID()}`,
      runId: current.runId,
      revision: 1,
      messages: [{
        messageId: `message_${randomUUID()}`,
        senderId: null,
        role: "system",
        body: "This is the shared activity chat. Senior Quest will help when the group discusses coordination or requests a change.",
        kind: "text",
        createdAt: now,
      }],
      visibleAppointmentVersion: null,
      readBy: {},
      updatedAt: now,
    };
    return this.dependencies.store.saveEventCoordinationState({
      ...current,
      lifecycle: "awaiting_responses",
      revision: current.revision + 1,
      rosterValidation: latestValidation,
      invitations: [...current.invitations, ...invitations],
      memberships,
      threads: [...current.threads, ...threads],
      groupThread,
      notifications: [...current.notifications, ...notifications],
      auditEvents: [...current.auditEvents, this.auditEvent(current, "roster_confirmed", input.actorId, input.idempotencyKey, {
        rosterRevision: current.rosterRevision,
        invitedGuestIds: invitations.map((invitation) => invitation.guestId),
      }, "awaiting_responses")],
      outbox: [...current.outbox, ...invitations.flatMap((invitation) => [{
        jobId: `outbox_${randomUUID()}`,
        kind: "invitation" as const,
        recipientId: invitation.guestId,
        deduplicationKey: `invitation:${invitation.invitationId}`,
        payload: { runId: current.runId, invitationId: invitation.invitationId },
        status: "pending" as const,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }, {
        jobId: `outbox_${randomUUID()}`,
        kind: "notification" as const,
        recipientId: invitation.guestId,
        deduplicationKey: `notification:invitation:${invitation.invitationId}`,
        payload: { runId: current.runId, invitationId: invitation.invitationId },
        status: "pending" as const,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }])],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: now,
    }, current.revision);
  }

  async getCoordinationThread(runId: string, actorId: string): Promise<EventCoordinationThread> {
    const state = await this.requireState(runId);
    const thread = state.threads.find((candidate) => candidate.userId === actorId);
    if (!thread || !this.canViewCoordination(state, actorId)) {
      throw new Error("You cannot view another participant's coordination conversation");
    }
    return structuredClone(thread);
  }

  async addCoordinationMessage(input: {
    runId: string;
    actorId: string;
    body: string;
    clientMessageId: string;
    expectedRevision: number;
  }): Promise<EventCoordinationThread> {
    const current = await this.requireState(input.runId);
    const thread = current.threads.find((candidate) => candidate.userId === input.actorId);
    if (!thread) throw new Error("You cannot update another participant's coordination conversation");
    if (!this.canCoordinate(current, input.actorId)) throw new Error("You are not allowed to update this coordination conversation");
    if (thread.messages.some((message) => message.messageId === input.clientMessageId)) return structuredClone(thread);
    if (thread.revision !== input.expectedRevision) {
      throw new Error("Coordination conversation conflict; reload and retry");
    }
    const now = new Date().toISOString();
    const participantMessage = {
      messageId: input.clientMessageId,
      role: "participant" as const,
      body: input.body,
      kind: "text" as const,
      createdAt: now,
    };
    const acceptedThread: EventCoordinationThread = {
      ...thread,
      revision: thread.revision + 1,
      messages: [...thread.messages, participantMessage],
      updatedAt: now,
    };
    // A participant's send is authoritative and must not share the hosted
    // agent's failure boundary. Agent output is a follow-up mutation.
    const acceptedState = await this.dependencies.store.saveEventCoordinationState({
      ...current,
      revision: current.revision + 1,
      threads: current.threads.map((candidate) => candidate.threadId === thread.threadId ? acceptedThread : candidate),
      auditEvents: [...current.auditEvents, this.auditEvent(current, "coordination_message_added", input.actorId, null, {
        threadId: thread.threadId,
        messageId: input.clientMessageId,
      }, current.lifecycle)],
      updatedAt: now,
    }, current.revision);
    let output: Awaited<ReturnType<NonNullable<EventCoordinatorDependencies["coordinate"]>>>;
    try {
      output = this.dependencies.coordinate
        ? await this.dependencies.coordinate({ state: acceptedState, thread, message: input.body, scope: "private" })
        : { reply: "Thank you. I have noted this for coordination.", requirementPatch: undefined };
    } catch (error) {
      logger.warn("event_coordination.agent_failed", {
        runId: input.runId,
        scope: "private",
        error: safeErrorMessage(error),
      });
      const failureAt = new Date().toISOString();
      const failedThread: EventCoordinationThread = {
        ...acceptedThread,
        messages: [...acceptedThread.messages, {
          messageId: `message_${randomUUID()}`,
          role: "assistant",
          body: "I couldn't process that message right now. Your message was saved; please try asking Senior Quest again.",
          kind: "text",
          createdAt: failureAt,
        }],
        updatedAt: failureAt,
      };
      try {
        await this.dependencies.store.saveEventCoordinationState({
          ...acceptedState,
          revision: acceptedState.revision + 1,
          threads: acceptedState.threads.map((candidate) => candidate.threadId === thread.threadId ? failedThread : candidate),
          updatedAt: failureAt,
        }, acceptedState.revision);
        return structuredClone(failedThread);
      } catch {
        return structuredClone(acceptedThread);
      }
    }
    const responseState = await this.requireState(input.runId);
    const responseThread = responseState.threads.find((candidate) => candidate.userId === input.actorId);
    if (!responseThread || !responseThread.messages.some((message) => message.messageId === input.clientMessageId)) {
      return structuredClone(acceptedThread);
    }
    const questionReply = output.intent?.type === "question"
      ? await this.answerCoordinationQuestion(responseState, output.intent.topic)
      : null;
    const organizerAction = output.intent?.type === "organizer_action"
      ? this.prepareOrganizerAction(responseState, input.actorId, output.intent, now)
      : null;
    let appointmentChange: Awaited<ReturnType<EventCoordinator["prepareAppointmentChange"]>> | null = null;
    let appointmentConflict: { suggestion: EventAppointmentSuggestion | null; reply: string } | null = null;
    let acceptedSuggestionId: string | null = null;
    if (output.intent?.type === "change_appointment") {
      try {
        const resolved = this.resolveAppointmentIntentPatch(responseState, output.intent, now);
        acceptedSuggestionId = resolved.suggestionId;
        appointmentChange = await this.prepareAppointmentChange(responseState, input.actorId, resolved.patch, input.clientMessageId, now);
      } catch (error) {
        if (!(error instanceof AppointmentIncompatibleError)) throw error;
        appointmentConflict = this.prepareAppointmentConflict(responseState, output.intent.patch, input.clientMessageId, error, now);
      }
    }
    const responseActorProfile = output.intent?.type === "confirm_appointment" || output.intent?.type === "reject_appointment"
      ? await this.dependencies.resolveMember?.(input.actorId)
      : null;
    const responseActorName = responseActorProfile?.displayName ?? "A participant";
    let appointmentConfirmation: ReturnType<EventCoordinator["prepareAppointmentConfirmation"]> | null = null;
    let appointmentRejection: ReturnType<EventCoordinator["prepareAppointmentRejection"]> | null = null;
    let appointmentResponseError: string | null = null;
    try {
      appointmentConfirmation = output.intent?.type === "confirm_appointment"
        ? this.prepareAppointmentConfirmation(responseState, input.actorId, responseActorName, responseThread.visibleAppointmentVersion, now)
        : null;
      appointmentRejection = output.intent?.type === "reject_appointment"
        ? this.prepareAppointmentRejection(responseState, input.actorId, responseActorName, responseThread.visibleAppointmentVersion, now)
        : null;
    } catch (error) {
      appointmentResponseError = safeErrorMessage(error);
    }
    const appointmentMutation = appointmentChange ?? appointmentConfirmation ?? appointmentRejection;
    const updatedThread: EventCoordinationThread = {
      ...responseThread,
      messages: [...responseThread.messages, {
        messageId: `message_${randomUUID()}`,
        role: "assistant",
        body: appointmentMutation?.reply ?? appointmentConflict?.reply ?? appointmentResponseError ?? organizerAction?.reply ?? questionReply ?? output.reply,
        kind: appointmentMutation?.broadcastKind ?? (organizerAction?.mutation ? "change_card" : "text"),
        createdAt: now,
      }],
      pendingRequirements: output.requirementPatch
        ? { ...(responseThread.pendingRequirements ?? {}), ...output.requirementPatch }
        : responseThread.pendingRequirements,
      visibleAppointmentVersion: appointmentMutation?.version ?? responseThread.visibleAppointmentVersion,
      updatedAt: now,
    };
    const sharedAvailability = input.actorId !== responseState.initiatorId
      && this.hasAvailabilityUpdate(output.requirementPatch);
    const actorProfile = sharedAvailability
      ? await this.dependencies.resolveMember?.(input.actorId)
      : null;
    const actorName = actorProfile?.displayName ?? this.displayMember(input.actorId);
    const availabilityNotification = sharedAvailability ? {
      notificationId: `notification_${randomUUID()}`,
      userId: responseState.initiatorId,
      kind: "availability_shared" as const,
      title: `${actorName} shared availability`,
      body: `Availability is waiting for ${actorName} to confirm.`,
      readAt: null,
      deduplicationKey: `availability-shared:${thread.threadId}:${updatedThread.revision}`,
      createdAt: now,
    } : null;
    const notifications = [
      ...(organizerAction?.mutation?.notifications ?? appointmentMutation?.notifications ?? responseState.notifications),
      ...(availabilityNotification ? [availabilityNotification] : []),
    ];
    const appointmentOutbox = appointmentMutation?.newNotifications.map((notification) => ({
      jobId: `outbox_${randomUUID()}`,
      kind: "notification" as const,
      recipientId: notification.userId,
      deduplicationKey: notification.deduplicationKey,
      payload: { runId: current.runId, notificationId: notification.notificationId },
      status: "pending" as const,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    })) ?? [];
    const organizerOutbox = organizerAction?.mutation?.newNotifications.map((notification) => ({
      jobId: `outbox_${randomUUID()}`,
      kind: "notification" as const,
      recipientId: notification.userId,
      deduplicationKey: notification.deduplicationKey,
      payload: { runId: current.runId, notificationId: notification.notificationId },
      status: "pending" as const,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    })) ?? [];
    const groupBroadcast = appointmentMutation?.reply ?? (organizerAction?.mutation ? organizerAction.reply : null);
    const groupThread = groupBroadcast && responseState.groupThread ? {
      ...responseState.groupThread,
      revision: responseState.groupThread.revision + 1,
      messages: [...responseState.groupThread.messages, {
        messageId: `message_${randomUUID()}`,
        senderId: null,
        role: "system" as const,
        body: groupBroadcast,
        kind: appointmentMutation?.broadcastKind ?? "change_card" as const,
        createdAt: now,
      }],
      visibleAppointmentVersion: appointmentMutation?.version ?? responseState.groupThread.visibleAppointmentVersion,
      updatedAt: now,
    } : responseState.groupThread;
    const savedState = await this.dependencies.store.saveEventCoordinationState({
      ...responseState,
      lifecycle: organizerAction?.mutation?.lifecycle ?? appointmentMutation?.lifecycle ?? responseState.lifecycle,
      revision: responseState.revision + 1,
      threads: responseState.threads.map((candidate) => candidate.threadId === responseThread.threadId
        ? updatedThread
        : appointmentMutation ? {
            ...candidate,
            revision: candidate.revision + 1,
            messages: [...candidate.messages, {
              messageId: `message_${randomUUID()}`,
              role: "system" as const,
              body: appointmentMutation.reply,
              kind: appointmentMutation.broadcastKind,
              createdAt: now,
            }],
            visibleAppointmentVersion: appointmentMutation.version,
            updatedAt: now,
          } : candidate),
      groupThread,
      arrangements: organizerAction?.mutation?.arrangements ?? appointmentMutation?.arrangements ?? responseState.arrangements,
      appointmentSuggestions: appointmentConflict?.suggestion
        ? [...responseState.appointmentSuggestions, appointmentConflict.suggestion]
        : acceptedSuggestionId && appointmentChange
          ? responseState.appointmentSuggestions.map((suggestion) => suggestion.suggestionId === acceptedSuggestionId
            ? { ...suggestion, status: "accepted" as const }
            : suggestion)
          : responseState.appointmentSuggestions,
      memberships: organizerAction?.mutation?.memberships ?? appointmentMutation?.memberships ?? responseState.memberships,
      invitations: organizerAction?.mutation?.invitations ?? responseState.invitations,
      notifications,
      outbox: [...(organizerAction?.mutation?.outbox ?? responseState.outbox), ...appointmentOutbox, ...organizerOutbox, ...(availabilityNotification ? [{
        jobId: `outbox_${randomUUID()}`,
        kind: "notification" as const,
        recipientId: current.initiatorId,
        deduplicationKey: availabilityNotification.deduplicationKey,
        payload: {
          runId: current.runId,
          notificationId: availabilityNotification.notificationId,
        },
        status: "pending" as const,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }] : [])],
      auditEvents: responseState.auditEvents,
      updatedAt: now,
    }, responseState.revision);
    if (savedState.lifecycle === "scheduled") await this.ensureTaskPlan(savedState);
    return structuredClone(updatedThread);
  }

  async getGroupCoordinationThread(runId: string, actorId: string): Promise<EventGroupCoordinationThread> {
    const state = await this.requireState(runId);
    if (!state.groupThread || !this.canUseGroupCoordination(state, actorId)) {
      throw new Error("The shared activity conversation is not available");
    }
    return structuredClone(state.groupThread);
  }

  async addGroupCoordinationMessage(input: {
    runId: string;
    actorId: string;
    body: string;
    clientMessageId: string;
    expectedRevision: number;
  }): Promise<EventGroupCoordinationThread> {
    const current = await this.requireState(input.runId);
    const group = current.groupThread;
    if (!group || !this.canUseGroupCoordination(current, input.actorId)) {
      throw new Error("The shared activity conversation is not available");
    }
    if (group.messages.some((message) => message.messageId === input.clientMessageId)) return structuredClone(group);
    if (group.revision !== input.expectedRevision) throw new Error("Group conversation conflict; reload and retry");
    const privateThread = current.threads.find((thread) => thread.userId === input.actorId);
    if (!privateThread) throw new Error("Your private coordination context was not found");
    const now = new Date().toISOString();
    const actor = await this.dependencies.resolveMember?.(input.actorId);
    const actorName = actor?.displayName ?? this.displayMember(input.actorId);
    const groupMessageNotifications = current.memberships
      .filter((membership) => this.isActiveMembership(membership) && membership.userId !== input.actorId)
      .map((membership) => ({
        notificationId: `notification_${randomUUID()}`,
        userId: membership.userId,
        kind: "group_message" as const,
        title: `${actorName} sent a group message`,
        body: input.body,
        readAt: null,
        deduplicationKey: `group-message:${input.runId}:${input.clientMessageId}:${membership.userId}`,
        createdAt: now,
      }));
    const groupMessageOutbox = groupMessageNotifications.map((notification) => ({
      jobId: `outbox_${randomUUID()}`,
      kind: "notification" as const,
      recipientId: notification.userId,
      deduplicationKey: notification.deduplicationKey,
      payload: { runId: input.runId, notificationId: notification.notificationId },
      status: "pending" as const,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }));
    const participantMessage = {
      messageId: input.clientMessageId,
      senderId: input.actorId,
      role: "participant" as const,
      body: input.body,
      kind: "text" as const,
      createdAt: now,
    };
    const acceptedGroup: EventGroupCoordinationThread = {
      ...group,
      revision: group.revision + 1,
      messages: [...group.messages, participantMessage],
      updatedAt: now,
    };
    // Keep the human message even when the hosted coordinator is slow or
    // unavailable; its response is enrichment, not part of message delivery.
    const acceptedState = await this.dependencies.store.saveEventCoordinationState({
      ...current,
      revision: current.revision + 1,
      groupThread: acceptedGroup,
      notifications: [...current.notifications, ...groupMessageNotifications],
      outbox: [...current.outbox, ...groupMessageOutbox],
      auditEvents: [...current.auditEvents, this.auditEvent(current, "group_coordination_message_added", input.actorId, null, {
        threadId: group.threadId,
        messageId: input.clientMessageId,
      }, current.lifecycle)],
      updatedAt: now,
    }, current.revision);
    const groupContext: EventCoordinationThread = {
      ...privateThread,
      messages: acceptedGroup.messages,
      confirmedRequirements: this.emptyRequirements(),
      pendingRequirements: null,
    };
    let output: Awaited<ReturnType<NonNullable<EventCoordinatorDependencies["coordinate"]>>>;
    try {
      output = this.dependencies.coordinate
        ? await this.dependencies.coordinate({ state: acceptedState, thread: groupContext, message: input.body, scope: "group" })
        : { reply: "Thank you. I have noted this for the group.", requirementPatch: undefined };
    } catch (error) {
      logger.warn("event_coordination.agent_failed", {
        runId: input.runId,
        scope: "group",
        error: safeErrorMessage(error),
      });
      const failureAt = new Date().toISOString();
      const failedGroup: EventGroupCoordinationThread = {
        ...acceptedGroup,
        messages: [...acceptedGroup.messages, {
          messageId: `message_${randomUUID()}`,
          senderId: null,
          role: "assistant",
          body: "I couldn't process that message right now. Your message was delivered to the group; please try asking Senior Quest again.",
          kind: "text",
          createdAt: failureAt,
        }],
        updatedAt: failureAt,
      };
      try {
        await this.dependencies.store.saveEventCoordinationState({
          ...acceptedState,
          revision: acceptedState.revision + 1,
          groupThread: failedGroup,
          updatedAt: failureAt,
        }, acceptedState.revision);
        return structuredClone(failedGroup);
      } catch {
        return structuredClone(acceptedGroup);
      }
    }
    const responseState = await this.requireState(input.runId);
    const responseGroup = responseState.groupThread;
    const responsePrivateThread = responseState.threads.find((thread) => thread.userId === input.actorId);
    if (!responseGroup || !responsePrivateThread
      || !responseGroup.messages.some((message) => message.messageId === input.clientMessageId)) {
      return structuredClone(acceptedGroup);
    }
    const questionReply = output.intent?.type === "question"
      ? await this.answerCoordinationQuestion(responseState, output.intent.topic)
      : null;
    const organizerAction = output.intent?.type === "organizer_action"
      ? this.prepareOrganizerAction(responseState, input.actorId, output.intent, now)
      : null;
    let appointmentChange: Awaited<ReturnType<EventCoordinator["prepareAppointmentChange"]>> | null = null;
    let appointmentConflict: { suggestion: EventAppointmentSuggestion | null; reply: string } | null = null;
    let acceptedSuggestionId: string | null = null;
    if (output.intent?.type === "change_appointment") {
      try {
        const resolved = this.resolveAppointmentIntentPatch(responseState, output.intent, now);
        acceptedSuggestionId = resolved.suggestionId;
        appointmentChange = await this.prepareAppointmentChange(responseState, input.actorId, resolved.patch, input.clientMessageId, now);
      } catch (error) {
        if (!(error instanceof AppointmentIncompatibleError)) throw error;
        appointmentConflict = this.prepareAppointmentConflict(responseState, output.intent.patch, input.clientMessageId, error, now);
      }
    }
    const responseActorProfile = output.intent?.type === "confirm_appointment" || output.intent?.type === "reject_appointment"
      ? await this.dependencies.resolveMember?.(input.actorId)
      : null;
    const responseActorName = responseActorProfile?.displayName ?? "A participant";
    let appointmentConfirmation: ReturnType<EventCoordinator["prepareAppointmentConfirmation"]> | null = null;
    let appointmentRejection: ReturnType<EventCoordinator["prepareAppointmentRejection"]> | null = null;
    let appointmentResponseError: string | null = null;
    try {
      appointmentConfirmation = output.intent?.type === "confirm_appointment"
        ? this.prepareAppointmentConfirmation(responseState, input.actorId, responseActorName, responseGroup.visibleAppointmentVersion, now)
        : null;
      appointmentRejection = output.intent?.type === "reject_appointment"
        ? this.prepareAppointmentRejection(responseState, input.actorId, responseActorName, responseGroup.visibleAppointmentVersion, now)
        : null;
    } catch (error) {
      appointmentResponseError = safeErrorMessage(error);
    }
    const appointmentMutation = appointmentChange ?? appointmentConfirmation ?? appointmentRejection;
    const shouldReply = output.intent?.type !== "social";
    const messages: EventCoordinationMessage[] = [
      ...responseGroup.messages,
      ...(shouldReply ? [{
        messageId: `message_${randomUUID()}`,
        senderId: null,
        role: "assistant" as const,
        body: appointmentMutation?.reply ?? appointmentConflict?.reply ?? appointmentResponseError ?? organizerAction?.reply ?? questionReply ?? output.reply,
        kind: appointmentMutation?.broadcastKind ?? (organizerAction?.mutation ? "change_card" as const : "text" as const),
        createdAt: now,
      }] : []),
    ];
    const updatedGroup: EventGroupCoordinationThread = {
      ...responseGroup,
      messages,
      visibleAppointmentVersion: appointmentMutation?.version ?? responseGroup.visibleAppointmentVersion,
      updatedAt: now,
    };
    const hasRequirementPatch = Boolean(output.requirementPatch && Object.keys(output.requirementPatch).length > 0);
    const updatedPrivateThread: EventCoordinationThread = hasRequirementPatch ? {
      ...responsePrivateThread,
      revision: responsePrivateThread.revision + 1,
      pendingRequirements: { ...(responsePrivateThread.pendingRequirements ?? {}), ...output.requirementPatch },
      messages: [...responsePrivateThread.messages, {
        messageId: `message_${randomUUID()}`,
        senderId: null,
        role: "system",
        body: "A requirement shared in the group is ready for you to review privately before it is used for coordination.",
        kind: "text",
        createdAt: now,
      }],
      updatedAt: now,
    } : responsePrivateThread;
    const appointmentOutbox = appointmentMutation?.newNotifications.map((notification) => ({
      jobId: `outbox_${randomUUID()}`,
      kind: "notification" as const,
      recipientId: notification.userId,
      deduplicationKey: notification.deduplicationKey,
      payload: { runId: current.runId, notificationId: notification.notificationId },
      status: "pending" as const,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    })) ?? [];
    const organizerOutbox = organizerAction?.mutation?.newNotifications.map((notification) => ({
      jobId: `outbox_${randomUUID()}`,
      kind: "notification" as const,
      recipientId: notification.userId,
      deduplicationKey: notification.deduplicationKey,
      payload: { runId: current.runId, notificationId: notification.notificationId },
      status: "pending" as const,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    })) ?? [];
    const savedState = await this.dependencies.store.saveEventCoordinationState({
      ...responseState,
      lifecycle: organizerAction?.mutation?.lifecycle ?? appointmentMutation?.lifecycle ?? responseState.lifecycle,
      revision: responseState.revision + 1,
      groupThread: updatedGroup,
      threads: responseState.threads.map((thread) => {
        const base = thread.threadId === responsePrivateThread.threadId ? updatedPrivateThread : thread;
        if (!appointmentMutation) return base;
        return {
          ...base,
          revision: base.revision + 1,
          messages: [...base.messages, {
            messageId: `message_${randomUUID()}`,
            role: "system" as const,
            body: appointmentMutation.reply,
            kind: appointmentMutation.broadcastKind,
            createdAt: now,
          }],
          visibleAppointmentVersion: appointmentMutation.version,
          updatedAt: now,
        };
      }),
      arrangements: organizerAction?.mutation?.arrangements ?? appointmentMutation?.arrangements ?? responseState.arrangements,
      appointmentSuggestions: appointmentConflict?.suggestion
        ? [...responseState.appointmentSuggestions, appointmentConflict.suggestion]
        : acceptedSuggestionId && appointmentChange
          ? responseState.appointmentSuggestions.map((suggestion) => suggestion.suggestionId === acceptedSuggestionId
            ? { ...suggestion, status: "accepted" as const }
            : suggestion)
          : responseState.appointmentSuggestions,
      memberships: organizerAction?.mutation?.memberships ?? appointmentMutation?.memberships ?? responseState.memberships,
      invitations: organizerAction?.mutation?.invitations ?? responseState.invitations,
      notifications: organizerAction?.mutation?.notifications ?? appointmentMutation?.notifications ?? responseState.notifications,
      outbox: [...(organizerAction?.mutation?.outbox ?? responseState.outbox), ...appointmentOutbox, ...organizerOutbox],
      auditEvents: responseState.auditEvents,
      updatedAt: now,
    }, responseState.revision);
    if (savedState.lifecycle === "scheduled") await this.ensureTaskPlan(savedState);
    return structuredClone(updatedGroup);
  }

  async confirmRequirements(input: {
    runId: string;
    actorId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<EventCoordinationThread> {
    const current = await this.requireState(input.runId);
    const thread = current.threads.find((candidate) => candidate.userId === input.actorId);
    if (!thread) throw new Error("You cannot update another participant's requirements");
    if (!this.canCoordinate(current, input.actorId)) throw new Error("You are not allowed to update these requirements");
    if (current.processedCommands.includes(input.idempotencyKey)) return structuredClone(thread);
    if (thread.revision !== input.expectedRevision) {
      throw new Error("Coordination conversation conflict; reload and retry");
    }
    if (!thread.pendingRequirements) throw new Error("There are no proposed requirements to confirm");
    const confirmedRequirements = structuredClone(thread.confirmedRequirements);
    for (const [key, values] of Object.entries(thread.pendingRequirements) as Array<[
      keyof CoordinationRequirements,
      string[] | CoordinationRequirements["availableWindows"] | undefined,
    ]>) {
      if (!values) continue;
      if (key === "availableWindows") {
        confirmedRequirements.availableWindows = values as CoordinationRequirements["availableWindows"];
      } else {
        confirmedRequirements[key] = [...new Set(values as string[])] as never;
      }
    }
    const now = new Date().toISOString();
    const updatedThread: EventCoordinationThread = {
      ...thread,
      revision: thread.revision + 1,
      confirmedRequirements,
      pendingRequirements: null,
      messages: [...thread.messages, {
        messageId: `message_${randomUUID()}`,
        role: "system",
        body: "Your coordination requirements are confirmed for this quest.",
        kind: "text",
        createdAt: now,
      }],
      updatedAt: now,
    };
    const confirmedAvailability = input.actorId !== current.initiatorId
      && this.hasAvailabilityUpdate(thread.pendingRequirements);
    const actorProfile = confirmedAvailability
      ? await this.dependencies.resolveMember?.(input.actorId)
      : null;
    const actorName = actorProfile?.displayName ?? this.displayMember(input.actorId);
    const availabilityNotification = confirmedAvailability ? {
      notificationId: `notification_${randomUUID()}`,
      userId: current.initiatorId,
      kind: "availability_confirmed" as const,
      title: `${actorName} confirmed availability`,
      body: "Availability is ready for coordination.",
      readAt: null,
      deduplicationKey: `availability-confirmed:${thread.threadId}:${updatedThread.revision}`,
      createdAt: now,
    } : null;
    await this.dependencies.store.saveEventCoordinationState({
      ...current,
      revision: current.revision + 1,
      threads: current.threads.map((candidate) => candidate.threadId === thread.threadId ? updatedThread : candidate),
      notifications: availabilityNotification
        ? [...current.notifications, availabilityNotification]
        : current.notifications,
      outbox: availabilityNotification ? [...current.outbox, {
        jobId: `outbox_${randomUUID()}`,
        kind: "notification",
        recipientId: current.initiatorId,
        deduplicationKey: availabilityNotification.deduplicationKey,
        payload: {
          runId: current.runId,
          notificationId: availabilityNotification.notificationId,
        },
        status: "pending",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }] : current.outbox,
      auditEvents: [...current.auditEvents, this.auditEvent(current, "requirements_confirmed", input.actorId, input.idempotencyKey, {
        threadId: thread.threadId,
        requirementCategories: Object.keys(thread.pendingRequirements),
        availabilityConfirmed: confirmedAvailability,
      }, current.lifecycle)],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: now,
    }, current.revision);
    return structuredClone(updatedThread);
  }

  async proposeArrangement(input: {
    runId: string;
    actorId: string;
    start: string;
    end: string;
    venueName: string;
    venueAddress: string | null;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.processedCommands.includes(input.idempotencyKey)) return current;
    if (current.initiatorId !== input.actorId) throw new Error("Only the organizer can propose an arrangement");
    if (current.revision !== input.expectedRevision) throw new Error("Quest state conflict; reload and retry");
    if (!current.memberships.some((membership) => membership.userId === input.actorId && membership.role === "organizer")) {
      throw new Error("Confirm the quest roster before proposing an arrangement");
    }
    if (current.invitations.some((invitation) => invitation.status === "pending")) {
      throw new Error("Wait for every current invitation response before proposing a final arrangement");
    }
    if (current.memberships.filter((membership) => this.isActiveMembership(membership)).length < current.proposal.quest.groupSize) {
      throw new Error("Every person in the confirmed roster must be an active member before proposing an arrangement");
    }
    if (Date.parse(input.end) <= Date.parse(input.start)) throw new Error("Arrangement end must be after start");
    if (!input.venueName.trim()) throw new Error("A public venue is required");
    const durationMinutes = (Date.parse(input.end) - Date.parse(input.start)) / 60_000;
    if (durationMinutes > 120) throw new Error("Quest duration cannot exceed 120 minutes");
    const arrangementValidation = await this.dependencies.validateArrangement?.({
      state: current,
      start: new Date(input.start).toISOString(),
      end: new Date(input.end).toISOString(),
      venueName: input.venueName.trim(),
    });
    if (arrangementValidation && !arrangementValidation.valid) {
      throw new Error(arrangementValidation.errors.map((error) => error.message).join(" "));
    }
    const previous = [...current.arrangements].reverse().find((arrangement) => arrangement.status === "finalized");
    const now = new Date().toISOString();
    const materialChanges = this.materialChanges(previous, input);
    const informationalRevision = Boolean(previous && materialChanges.length === 0);
    const arrangement: EventArrangement = {
      arrangementId: `arrangement_${randomUUID()}`,
      version: (current.arrangements.at(-1)?.version ?? 0) + 1,
      start: new Date(input.start).toISOString(),
      end: new Date(input.end).toISOString(),
      venueName: input.venueName.trim(),
      venueAddress: input.venueAddress?.trim() || null,
      venueStatus: informationalRevision ? "participant_confirmed" : "proposed",
      status: informationalRevision ? "finalized" : "proposed",
      materialChanges,
      confirmations: informationalRevision ? structuredClone(previous?.confirmations ?? []) : [],
      createdAt: now,
      updatedAt: now,
    };
    const arrangements = current.arrangements.map((candidate): EventArrangement =>
      ["proposed", "initiator_approved", "awaiting_participant_confirmation"].includes(candidate.status)
        || (candidate.status === "finalized" && materialChanges.length > 0)
        ? { ...candidate, status: "superseded", updatedAt: now }
        : candidate,
    );
    const lifecycle = informationalRevision ? "scheduled" : "coordinating";
    const memberships = materialChanges.length > 0
      ? current.memberships.map((membership) => this.isActiveMembership(membership)
        ? { ...membership, status: "coordinating" as const, updatedAt: now }
        : membership)
      : current.memberships;
    const changeNotifications = materialChanges.length > 0
      ? current.memberships.filter((membership) => this.isActiveMembership(membership)).map((membership) => ({
          notificationId: `notification_${randomUUID()}`,
          userId: membership.userId,
          kind: "change" as const,
          title: "Quest arrangement changed",
          body: "A material change needs a new round of confirmation.",
          readAt: null,
          deduplicationKey: `arrangement-change:${arrangement.arrangementId}:${membership.userId}`,
          createdAt: now,
        }))
      : [];
    return this.dependencies.store.saveEventCoordinationState({
      ...current,
      lifecycle,
      revision: current.revision + 1,
      arrangements: [...arrangements, arrangement],
      memberships,
      taskPlans: materialChanges.length > 0
        ? current.taskPlans.map((plan) => ["generation_pending", "awaiting_acknowledgement", "active"].includes(plan.status)
          ? { ...plan, status: "suspended" as const, updatedAt: now }
          : plan)
        : current.taskPlans,
      notifications: [...current.notifications, ...changeNotifications],
      auditEvents: [...current.auditEvents, this.auditEvent(current, "arrangement_proposed", input.actorId, input.idempotencyKey, {
        arrangementId: arrangement.arrangementId,
        version: arrangement.version,
        materialChanges,
      }, lifecycle)],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: now,
    }, current.revision);
  }

  async suggestArrangement(input: {
    runId: string;
    actorId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.initiatorId !== input.actorId) throw new Error("Only the organizer can request an arrangement suggestion");
    if (!this.dependencies.suggestArrangement) throw new Error("Arrangement suggestions are unavailable");
    const suggestion = await this.dependencies.suggestArrangement(current);
    if (!suggestion) {
      throw new Error("No common availability currently fits the quest duration. Ask participants for more availability or adjust the group.");
    }
    return this.proposeArrangement({ ...input, ...suggestion });
  }

  async decideArrangement(input: {
    runId: string;
    arrangementId: string;
    actorId: string;
    action: "approve" | "reject" | "confirm";
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.processedCommands.includes(input.idempotencyKey)) return current;
    if (current.revision !== input.expectedRevision) throw new Error("Quest state conflict; reload and retry");
    const target = current.arrangements.find((arrangement) => arrangement.arrangementId === input.arrangementId);
    if (!target) throw new Error("Arrangement was not found");
    const now = new Date().toISOString();
    const actorProfile = await this.dependencies.resolveMember?.(input.actorId);
    const actorName = actorProfile?.displayName ?? "A participant";
    let arrangement = structuredClone(target);
    let lifecycle = current.lifecycle;
    let memberships = current.memberships;
    let threads = current.threads;
    let groupThread = current.groupThread;
    let notifications = current.notifications;

    if (input.action === "approve" || (input.action === "reject" && target.status === "proposed")) {
      if (current.initiatorId !== input.actorId) throw new Error("Only the organizer can approve an arrangement");
      if (target.status !== "proposed") throw new Error("This arrangement is not awaiting organizer approval");
      if (input.action === "reject") {
        arrangement = { ...arrangement, status: "rejected", updatedAt: now };
        lifecycle = "coordinating";
      } else {
        const confirmations = current.memberships.filter((membership) => this.isActiveMembership(membership)).map((membership) => ({
          userId: membership.userId,
          status: membership.role === "organizer" ? "confirmed" as const : "pending" as const,
          respondedAt: membership.role === "organizer" ? now : null,
        }));
        arrangement = {
          ...arrangement,
          status: "awaiting_participant_confirmation",
          confirmations,
          updatedAt: now,
        };
        lifecycle = "awaiting_confirmation";
        memberships = memberships.map((membership) => this.isActiveMembership(membership) ? ({
          ...membership,
          status: "awaiting_confirmation" as const,
          updatedAt: now,
        }) : membership);
        threads = threads.map((thread) => ({
          ...thread,
          revision: thread.revision + 1,
          messages: [...thread.messages, {
            messageId: `message_${randomUUID()}`,
            role: "system" as const,
            body: `${arrangement.venueName}, ${new Date(arrangement.start).toLocaleString()} is ready for confirmation.`,
            kind: "arrangement_card" as const,
            createdAt: now,
          }],
          visibleAppointmentVersion: arrangement.version,
          updatedAt: now,
        }));
        if (groupThread) {
          groupThread = {
            ...groupThread,
            revision: groupThread.revision + 1,
            messages: [...groupThread.messages, {
              messageId: `message_${randomUUID()}`,
              senderId: null,
              role: "system",
              body: `${arrangement.venueName}, ${formatAppointmentInstant(arrangement.start, current.timeZone)} is ready for confirmation.`,
              kind: "arrangement_card",
              createdAt: now,
            }],
            visibleAppointmentVersion: arrangement.version,
            updatedAt: now,
          };
        }
        notifications = [...notifications, ...current.memberships
          .filter((membership) => membership.role === "participant" && this.isActiveMembership(membership))
          .map((membership) => ({
            notificationId: `notification_${randomUUID()}`,
            userId: membership.userId,
            kind: "arrangement" as const,
            title: "Confirm your quest arrangement",
            body: `${arrangement.venueName} · ${new Date(arrangement.start).toLocaleString()}`,
            readAt: null,
            deduplicationKey: `arrangement:${arrangement.arrangementId}:${membership.userId}`,
            createdAt: now,
          }))];
      }
    } else {
      if (target.status !== "awaiting_participant_confirmation") {
        throw new Error("This arrangement is not awaiting participant confirmation");
      }
      const membership = current.memberships.find((candidate) => candidate.userId === input.actorId);
      if (!membership || !this.isActiveMembership(membership)) {
        throw new Error("Only an active participant can confirm this arrangement");
      }
      const confirmation = arrangement.confirmations.find((candidate) => candidate.userId === input.actorId);
      if (!confirmation || confirmation.status !== "pending") throw new Error("Your confirmation is no longer pending");
      arrangement.confirmations = arrangement.confirmations.map((candidate) => candidate.userId === input.actorId
        ? { ...candidate, status: input.action === "reject" ? "rejected" : "confirmed", respondedAt: now }
        : candidate);
      if (input.action === "reject") {
        arrangement.status = "rejected";
        lifecycle = "coordinating";
        memberships = memberships.map((candidate) => this.isActiveMembership(candidate)
          ? { ...candidate, status: "coordinating" as const, updatedAt: now }
          : candidate);
        notifications = [...notifications, ...current.memberships.filter((candidate) =>
          this.isActiveMembership(candidate) && candidate.userId !== input.actorId).map((candidate) => ({
          notificationId: `notification_${randomUUID()}`,
          userId: candidate.userId,
          kind: "change" as const,
          title: "Arrangement needs adjustment",
          body: `${actorName} cannot make the proposed arrangement.`,
          readAt: null,
          deduplicationKey: `arrangement-rejected:${arrangement.arrangementId}:${input.actorId}:${candidate.userId}`,
          createdAt: now,
        }))];
      }
      const finalized = arrangement.confirmations.every((candidate) => candidate.status === "confirmed");
      if (finalized) {
        arrangement.status = "finalized";
        arrangement.venueStatus = "participant_confirmed";
        lifecycle = "scheduled";
        memberships = memberships.map((candidate) => this.isActiveMembership(candidate)
          ? { ...candidate, status: "confirmed" as const, updatedAt: now }
          : candidate);
      }
      arrangement.updatedAt = now;

      const responseBody = input.action === "reject"
        ? `${actorName} can’t make appointment version ${arrangement.version}. Senior Quest will help the group find another option.`
        : finalized
          ? `Everyone has confirmed appointment version ${arrangement.version}. The plan is final.`
          : `${actorName} confirmed appointment version ${arrangement.version}. ${arrangement.confirmations.filter((candidate) => candidate.status === "pending").length} still to confirm.`;
      threads = threads.map((candidate) => ({
        ...candidate,
        revision: candidate.revision + 1,
        messages: [...candidate.messages, {
          messageId: `message_${randomUUID()}`,
          role: "system" as const,
          body: responseBody,
          kind: "arrangement_card" as const,
          createdAt: now,
        }],
        updatedAt: now,
      }));
      if (groupThread) {
        groupThread = {
          ...groupThread,
          revision: groupThread.revision + 1,
          messages: [...groupThread.messages, {
            messageId: `message_${randomUUID()}`,
            senderId: null,
            role: "system",
            body: responseBody,
            kind: "arrangement_card",
            createdAt: now,
          }],
          updatedAt: now,
        };
      }
      if (input.action === "confirm") {
        const recipients = finalized
          ? current.memberships.filter((candidate) => this.isActiveMembership(candidate))
          : current.memberships.filter((candidate) => this.isActiveMembership(candidate) && candidate.userId !== input.actorId);
        notifications = [...notifications, ...recipients.map((candidate) => ({
          notificationId: `notification_${randomUUID()}`,
          userId: candidate.userId,
          kind: "arrangement" as const,
          title: finalized ? "Everyone confirmed the plan" : `${actorName} confirmed the plan`,
          body: responseBody,
          readAt: null,
          deduplicationKey: `arrangement-response:${arrangement.arrangementId}:${input.actorId}:${candidate.userId}`,
          createdAt: now,
        }))];
      }
    }

    const saved = await this.dependencies.store.saveEventCoordinationState({
      ...current,
      lifecycle,
      revision: current.revision + 1,
      arrangements: current.arrangements.map((candidate) => candidate.arrangementId === target.arrangementId ? arrangement : candidate),
      memberships,
      threads,
      groupThread,
      notifications,
      outbox: [...current.outbox, ...notifications.slice(current.notifications.length).map((notification) => ({
        jobId: `outbox_${randomUUID()}`,
        kind: "notification" as const,
        recipientId: notification.userId,
        deduplicationKey: notification.deduplicationKey,
        payload: { runId: current.runId, notificationId: notification.notificationId },
        status: "pending" as const,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }))],
      auditEvents: [...current.auditEvents, this.auditEvent(current, `arrangement_${input.action}`, input.actorId, input.idempotencyKey, {
        arrangementId: target.arrangementId,
        arrangementStatus: arrangement.status,
      }, lifecycle)],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: now,
    }, current.revision);
    return saved.lifecycle === "scheduled" ? this.ensureTaskPlan(saved) : saved;
  }

  async updateRoster(input: {
    runId: string;
    actorId: string;
    expectedRevision: number;
    action: "add" | "remove";
    userId: string;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.initiatorId !== input.actorId) throw new Error("Only the quest organizer can edit the roster");
    if (current.lifecycle !== "forming") throw new Error("Invitations have already been prepared for this roster");
    if (current.revision !== input.expectedRevision) throw new Error("Quest state conflict; reload and retry");
    if (input.userId === current.initiatorId && input.action === "remove") {
      throw new Error("The organizer cannot be removed from the roster");
    }
    const existing = current.roster.find((member) => member.userId === input.userId);
    if (input.action === "add" && existing) throw new Error("This person is already in the roster");
    if (input.action === "remove" && !existing) throw new Error("This person is not in the roster");

    let roster = current.roster;
    let participants = current.proposal.proposedParticipants;
    if (input.action === "add") {
      const resolved = await this.dependencies.resolveParticipant?.(input.userId);
      if (!resolved) throw new Error("This person is not currently eligible for this quest");
      roster = [...roster, {
        userId: input.userId,
        source: "manual",
        proposedRole: resolved.participant.proposedRole,
        explanation: resolved.explanation,
      }];
      participants = [...participants, resolved.participant];
    } else {
      roster = roster.filter((member) => member.userId !== input.userId);
      participants = participants.filter((participant) => participant.candidateId !== input.userId);
    }
    const proposal: QuestProposal = {
      ...structuredClone(current.proposal),
      quest: {
        ...current.proposal.quest,
        groupSize: participants.length,
        needsAddressed: [...new Set(participants.flatMap((participant) => participant.needsAddressed))],
      },
      proposedParticipants: participants,
    };
    const rosterValidation = this.dependencies.validateRoster
      ? await this.dependencies.validateRoster(proposal)
      : this.basicRosterValidation(proposal);
    const now = new Date().toISOString();
    const recruitment = current.recruitment.publishedAt && roster.length < current.recruitment.targetGroupSize
      ? { ...current.recruitment, status: "open" as const }
      : current.recruitment.status === "draft" && roster.length >= current.recruitment.minimumGroupSize
        ? { ...current.recruitment, status: "closed" as const }
        : current.recruitment;
    const lifecycle = recruitment.status === "open" ? "recruiting" as const : current.lifecycle;
    const rosterNotifications = input.action === "add" ? [
      {
        notificationId: `notification_${randomUUID()}`,
        userId: input.userId,
        kind: "invitation" as const,
        title: "A compatible activity was found",
        body: `You may fit the group for ${current.proposal.quest.title}. Review it before the organizer confirms the roster.`,
        readAt: null,
        deduplicationKey: `roster-match:${current.runId}:${input.userId}:${current.rosterRevision + 1}`,
        createdAt: now,
      },
      {
        notificationId: `notification_${randomUUID()}`,
        userId: current.initiatorId,
        kind: "invitation" as const,
        title: "A compatible neighbour was found",
        body: "Review the updated group before preparing invitations.",
        readAt: null,
        deduplicationKey: `roster-match-organizer:${current.runId}:${input.userId}:${current.rosterRevision + 1}`,
        createdAt: now,
      },
    ] : [];
    const invitations = input.action === "remove"
      ? current.invitations.map((invitation): EventInvitation => invitation.guestId === input.userId
        && ["pending", "accepted"].includes(invitation.status)
        ? { ...invitation, status: "replaced", version: invitation.version + 1, deliveryState: invitation.deliveryState === "pending" ? "cancelled" : invitation.deliveryState, updatedAt: now }
        : invitation)
      : current.invitations;
    const memberships = input.action === "remove"
      ? current.memberships.map((membership): EventMembership => membership.userId === input.userId && this.isActiveMembership(membership)
        ? { ...membership, status: "replaced", updatedAt: now }
        : membership)
      : current.memberships;
    return this.dependencies.store.saveEventCoordinationState({
      ...current,
      lifecycle,
      revision: current.revision + 1,
      rosterRevision: current.rosterRevision + 1,
      roster,
      proposal,
      rosterValidation,
      recruitment,
      invitations,
      memberships,
      notifications: [...current.notifications, ...rosterNotifications],
      outbox: input.action === "remove" ? current.outbox.map((job) =>
        job.recipientId === input.userId && job.status === "pending"
          ? { ...job, status: "cancelled" as const, updatedAt: now }
          : job) : current.outbox,
      auditEvents: [...current.auditEvents, this.auditEvent(current, `roster_member_${input.action === "add" ? "added" : "removed"}`, input.actorId, null, {
        userId: input.userId,
        rosterRevision: current.rosterRevision + 1,
      }, lifecycle)],
      updatedAt: now,
    }, current.revision);
  }

  async respondToInvitation(input: {
    runId: string;
    invitationId: string;
    actorId: string;
    response: "accept" | "decline";
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.processedCommands.includes(input.idempotencyKey)) return current;
    if (current.revision !== input.expectedRevision) throw new Error("Quest state conflict; reload and retry");
    const invitation = current.invitations.find((candidate) => candidate.invitationId === input.invitationId);
    if (!invitation || invitation.guestId !== input.actorId) {
      throw new Error("You may respond only to your own invitation");
    }
    if (invitation.status !== "pending") throw new Error("This invitation is no longer pending");
    const now = new Date().toISOString();
    const invitations = current.invitations.map((candidate): EventInvitation => candidate.invitationId === input.invitationId
      ? {
          ...candidate,
          status: input.response === "accept" ? "accepted" : "declined",
          version: candidate.version + 1,
          updatedAt: now,
        }
      : candidate);
    const rosterMember = current.roster.find((member) => member.userId === input.actorId)!;
    const currentWorkingArrangement = [...current.arrangements].reverse().find((arrangement) =>
      arrangement.status === "awaiting_participant_confirmation");
    const memberships = input.response === "accept"
      ? [...current.memberships, {
          membershipId: `membership_${randomUUID()}`,
          runId: current.runId,
          userId: input.actorId,
          role: "participant" as const,
          rosterSource: rosterMember.source,
          status: currentWorkingArrangement ? "awaiting_confirmation" as const : "coordinating" as const,
          joinedAt: now,
          updatedAt: now,
        }]
      : current.memberships;
    const pending = invitations.some((candidate) => candidate.status === "pending");
    const lifecycle = pending
      ? current.lifecycle
      : memberships.length >= 2
        ? currentWorkingArrangement ? "awaiting_confirmation" as const : "coordinating" as const
        : "forming" as const;
    const arrangements = input.response === "accept" && currentWorkingArrangement
      ? current.arrangements.map((arrangement): EventArrangement => arrangement.arrangementId === currentWorkingArrangement.arrangementId
        ? {
            ...arrangement,
            confirmations: arrangement.confirmations.some((confirmation) => confirmation.userId === input.actorId)
              ? arrangement.confirmations
              : [...arrangement.confirmations, { userId: input.actorId, status: "pending", respondedAt: null }],
            updatedAt: now,
          }
        : arrangement)
      : current.arrangements;
    const responder = await this.dependencies.resolveMember?.(input.actorId);
    const responderName = responder?.displayName ?? this.displayMember(input.actorId);
    const responseNotification = {
      notificationId: `notification_${randomUUID()}`,
      userId: current.initiatorId,
      kind: "invitation_response" as const,
      title: `${responderName} ${input.response === "accept" ? "accepted" : "declined"}`,
      body: `${current.proposal.quest.title} invitation response`,
      readAt: null,
      deduplicationKey: `invitation-response:${invitation.invitationId}:${input.response}`,
      createdAt: now,
    };
    return this.dependencies.store.saveEventCoordinationState({
      ...current,
      lifecycle,
      revision: current.revision + 1,
      invitations,
      memberships,
      arrangements,
      notifications: [...current.notifications, responseNotification],
      auditEvents: [...current.auditEvents, this.auditEvent(current, `invitation_${input.response}ed`, input.actorId, input.idempotencyKey, {
        invitationId: invitation.invitationId,
      }, lifecycle)],
      outbox: [...current.outbox, {
        jobId: `outbox_${randomUUID()}`,
        kind: "notification",
        recipientId: current.initiatorId,
        deduplicationKey: responseNotification.deduplicationKey,
        payload: { runId: current.runId, invitationId: invitation.invitationId, response: input.response },
        status: "pending",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: now,
    }, current.revision);
  }

  async transitionInvitation(input: {
    runId: string;
    invitationId: string;
    actorId: string;
    action: "expire" | "withdraw" | "replace" | "cancel";
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.processedCommands.includes(input.idempotencyKey)) return current;
    if (current.revision !== input.expectedRevision) throw new Error("Quest state conflict; reload and retry");
    const invitation = current.invitations.find((candidate) => candidate.invitationId === input.invitationId);
    if (!invitation) throw new Error("Invitation was not found");
    const organizer = current.initiatorId === input.actorId;
    const guestWithdrawal = input.action === "withdraw" && invitation.guestId === input.actorId;
    if (!organizer && !guestWithdrawal) throw new Error("You are not allowed to change this invitation");
    const allowed = invitation.status === "pending"
      || (invitation.status === "accepted" && ["withdraw", "replace", "cancel"].includes(input.action));
    if (!allowed) throw new Error("This invitation transition is no longer valid");
    const nextStatus = ({ expire: "expired", withdraw: "withdrawn", replace: "replaced", cancel: "cancelled" } as const)[input.action];
    const membershipStatus = ({ withdraw: "withdrawn", replace: "replaced", cancel: "cancelled", expire: "withdrawn" } as const)[input.action];
    const now = new Date().toISOString();
    const invitations = current.invitations.map((candidate): EventInvitation => candidate.invitationId === invitation.invitationId
      ? {
          ...candidate,
          status: nextStatus,
          version: candidate.version + 1,
          deliveryState: candidate.deliveryState === "pending" ? "cancelled" : candidate.deliveryState,
          updatedAt: now,
        }
      : candidate);
    const memberships = current.memberships.map((membership): EventMembership => membership.userId === invitation.guestId
      && !["withdrawn", "replaced", "cancelled", "completed"].includes(membership.status)
      ? { ...membership, status: membershipStatus, updatedAt: now }
      : membership);
    const activeMemberships = memberships.filter((membership) =>
      !["withdrawn", "replaced", "cancelled"].includes(membership.status));
    const lifecycle = activeMemberships.length < current.proposal.quest.groupSize ? "forming" as const : "coordinating" as const;
    const notification = {
      notificationId: `notification_${randomUUID()}`,
      userId: organizer ? invitation.guestId : current.initiatorId,
      kind: "change" as const,
      title: `Invitation ${nextStatus}`,
      body: `${current.proposal.quest.title} needs a group update.`,
      readAt: null,
      deduplicationKey: `invitation:${invitation.invitationId}:${nextStatus}`,
      createdAt: now,
    };
    return this.dependencies.store.saveEventCoordinationState({
      ...current,
      lifecycle,
      revision: current.revision + 1,
      invitations,
      memberships,
      arrangements: current.arrangements.map((arrangement) =>
        ["proposed", "initiator_approved", "awaiting_participant_confirmation", "finalized"].includes(arrangement.status)
          ? { ...arrangement, status: "superseded" as const, updatedAt: now }
          : arrangement),
      notifications: [...current.notifications, notification],
      outbox: current.outbox.map((job) => job.deduplicationKey.includes(invitation.invitationId) && job.status === "pending"
        ? { ...job, status: "cancelled" as const, updatedAt: now }
        : job),
      auditEvents: [...current.auditEvents, this.auditEvent(current, `invitation_${nextStatus}`, input.actorId, input.idempotencyKey, {
        invitationId: invitation.invitationId,
        previousStatus: invitation.status,
        status: nextStatus,
      }, lifecycle)],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: now,
    }, current.revision);
  }

  async transitionQuest(input: {
    runId: string;
    actorId: string;
    action: "cancel" | "start" | "complete" | "reopen";
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.processedCommands.includes(input.idempotencyKey)) return current;
    if (current.initiatorId !== input.actorId) throw new Error("Only the organizer can change the quest lifecycle");
    if (current.revision !== input.expectedRevision) throw new Error("Quest state conflict; reload and retry");
    if (["completed", "cancelled"].includes(current.lifecycle)) throw new Error("This quest is already in a terminal state");
    const allowed = input.action === "cancel"
      || (input.action === "start" && current.lifecycle === "scheduled")
      || (input.action === "complete" && current.lifecycle === "in_progress")
      || (input.action === "reopen" && ["awaiting_responses", "coordinating", "awaiting_confirmation", "scheduled"].includes(current.lifecycle));
    if (!allowed) throw new Error("This quest lifecycle transition is not valid");
    const lifecycle = ({ cancel: "cancelled", start: "in_progress", complete: "completed", reopen: "forming" } as const)[input.action];
    const now = new Date().toISOString();
    const terminalMembership = input.action === "cancel" ? "cancelled" : input.action === "complete" ? "completed" : null;
    const cancellationRecipients = [...new Set([
      ...current.memberships.map((membership) => membership.userId),
      ...current.invitations.filter((invitation) => ["pending", "accepted"].includes(invitation.status)).map((invitation) => invitation.guestId),
    ])].filter((userId) => userId !== input.actorId);
    const notifications = input.action === "cancel"
      ? cancellationRecipients.map((userId) => ({
          notificationId: `notification_${randomUUID()}`,
          userId,
          kind: "cancellation" as const,
          title: "Quest cancelled",
          body: `${current.proposal.quest.title} has been cancelled by the organizer.`,
          readAt: null,
          deduplicationKey: `quest-cancelled:${current.runId}:${userId}`,
          createdAt: now,
        }))
      : [];
    const cancellationJobs = notifications.map((notification) => ({
      jobId: `outbox_${randomUUID()}`,
      kind: "notification" as const,
      recipientId: notification.userId,
      deduplicationKey: notification.deduplicationKey,
      payload: { runId: current.runId, notificationId: notification.notificationId },
      status: "pending" as const,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }));
    return this.dependencies.store.saveEventCoordinationState({
      ...current,
      lifecycle,
      revision: current.revision + 1,
      invitations: current.invitations.map((invitation): EventInvitation =>
        input.action === "cancel" && ["pending", "accepted"].includes(invitation.status)
          ? { ...invitation, status: "cancelled", version: invitation.version + 1, updatedAt: now }
          : input.action === "reopen" && invitation.status === "pending"
            ? { ...invitation, status: "withdrawn", version: invitation.version + 1, updatedAt: now }
            : invitation),
      memberships: current.memberships.map((membership) => terminalMembership
        ? { ...membership, status: terminalMembership, updatedAt: now }
        : input.action === "reopen" && membership.status === "awaiting_confirmation"
          ? { ...membership, status: "coordinating" as const, updatedAt: now }
          : membership),
      arrangements: current.arrangements.map((arrangement) =>
        (input.action === "cancel" || input.action === "reopen")
          && ["proposed", "initiator_approved", "awaiting_participant_confirmation", "finalized"].includes(arrangement.status)
          ? { ...arrangement, status: "superseded" as const, updatedAt: now }
          : arrangement),
      taskPlans: input.action === "cancel" || input.action === "reopen"
        ? current.taskPlans.map((plan) => ["generation_pending", "awaiting_acknowledgement", "active"].includes(plan.status)
          ? { ...plan, status: "suspended" as const, updatedAt: now }
          : plan)
        : current.taskPlans,
      notifications: [...current.notifications, ...notifications],
      outbox: input.action === "cancel"
        ? [...current.outbox.map((job) => job.status === "pending" ? { ...job, status: "cancelled" as const, updatedAt: now } : job), ...cancellationJobs]
        : current.outbox,
      auditEvents: [...current.auditEvents, this.auditEvent(current, `quest_${input.action}`, input.actorId, input.idempotencyKey, {}, lifecycle)],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: now,
    }, current.revision);
  }

  async markNotificationsRead(input: { actorId: string; runId?: string; includeGroupMessages?: boolean }): Promise<number> {
    const states = await this.dependencies.store.listEventCoordinationStates(input.actorId);
    let marked = 0;
    for (const current of states.filter((state) => !input.runId || state.runId === input.runId)) {
      const unread = current.notifications.filter((notification) =>
        notification.userId === input.actorId
        && notification.readAt === null
        && (input.includeGroupMessages
          ? notification.kind === "group_message"
          : notification.kind !== "group_message")).length;
      if (!unread) continue;
      const now = new Date().toISOString();
      await this.dependencies.store.saveEventCoordinationState({
        ...current,
        revision: current.revision + 1,
        notifications: current.notifications.map((notification) =>
          notification.userId === input.actorId
          && notification.readAt === null
          && (input.includeGroupMessages
            ? notification.kind === "group_message"
            : notification.kind !== "group_message")
            ? { ...notification, readAt: now }
            : notification),
        auditEvents: [...current.auditEvents, this.auditEvent(current, "notifications_read", input.actorId, null, { count: unread }, current.lifecycle)],
        updatedAt: now,
      }, current.revision);
      marked += unread;
    }
    return marked;
  }

  async hideSuggestion(input: { runId: string; actorId: string }): Promise<void> {
    const view = await this.getStateForUser(input.runId, input.actorId);
    if (view.lifecycle !== "recruiting"
      || view.recruitment.status !== "open"
      || view.viewer.role !== "applicant"
      || view.viewer.recruitmentEligibility === null) {
      throw new Error("Only the recipient of an open recruiting suggestion can hide it");
    }
    await this.dependencies.store.hideEventSuggestion(input.actorId, input.runId);
  }

  async ensureTaskPlan(state: EventCoordinationState): Promise<EventCoordinationState> {
    if (state.lifecycle !== "scheduled") return state;
    const currentPlans = state.taskPlans ?? [];
    const finalized = [...state.arrangements].reverse().find((arrangement) => arrangement.status === "finalized");
    if (!finalized) return state;
    const activeMemberships = state.memberships.filter((membership) => this.isActiveMembership(membership));
    const activeUserIds = activeMemberships.map((membership) => membership.userId);
    const goalHash = createHash("sha256")
      .update(`${state.proposal.quest.title}|${state.proposal.quest.sharedGoal}|${state.rosterRevision}`)
      .digest("hex")
      .slice(0, 16);
    const existing = [...currentPlans].reverse().find((plan) =>
      plan.rosterRevision === state.rosterRevision
      && plan.questGoalHash === goalHash
      && !["superseded", "suspended"].includes(plan.status));
    if (existing) {
      const pendingSince = Date.parse(existing.updatedAt);
      const stalePending = existing.status === "generation_pending"
        && Number.isFinite(pendingSince)
        && Date.now() - pendingSince >= TASK_PLAN_GENERATION_STALE_MS;
      return stalePending
        ? this.saveFailedTaskPlan(
            state.runId,
            existing.planId,
            "Task generation was interrupted. Please try again.",
          )
        : state;
    }

    const now = new Date().toISOString();
    const pending: EventTaskPlan = {
      planId: `task_plan_${randomUUID()}`,
      rosterRevision: state.rosterRevision,
      arrangementVersion: finalized.version,
      questGoalHash: goalHash,
      status: "generation_pending",
      roles: [],
      tasks: [],
      reassignments: [],
      generationAttempts: 1,
      generationError: null,
      createdAt: now,
      updatedAt: now,
    };
    const started = await this.dependencies.store.saveEventCoordinationState({
      ...state,
      taskPlans: [...currentPlans, pending],
      rewardEntries: state.rewardEntries ?? [],
      revision: state.revision + 1,
      auditEvents: [...state.auditEvents, this.auditEvent(state, "task_plan_generation_started", null, null, {
        planId: pending.planId,
        arrangementVersion: finalized.version,
      }, state.lifecycle)],
      updatedAt: now,
    }, state.revision);

    let generated: EventTaskPlan;
    let taskAnnouncement: string;
    let completedAt: string;
    let fallbackUsed = false;
    let normalized: EventTaskPlanAgentOutput | null = null;
    const taskInput = this.taskPlanInput(started, finalized.venueName, activeUserIds);
    try {
      const output = await this.generateTaskPlanWithTimeout(taskInput);
      const parsed = eventTaskPlanAgentOutputSchema.parse(output);
      normalized = normalizeEventTaskPlanReviewers(parsed, activeUserIds, state.initiatorId);
      fallbackUsed = validateEventTaskPlan(normalized, taskInput.participants, state.initiatorId).length > 0;
    } catch {
      fallbackUsed = true;
    }
    try {
      if (fallbackUsed || !normalized) {
        normalized = normalizeEventTaskPlanReviewers(
          fallbackTaskPlan(taskInput),
          activeUserIds,
          state.initiatorId,
        );
      }
      const errors = validateEventTaskPlan(normalized, taskInput.participants, state.initiatorId);
      if (errors.length) throw new Error(errors.join("; "));
      completedAt = new Date().toISOString();
      generated = this.materializeTaskPlan(pending, normalized, completedAt, state.initiatorId, activeUserIds);
      taskAnnouncement = `Senior Quest prepared ${generated.tasks.length} event tasks. Please review your role and task.`;
    } catch (error) {
      return this.saveFailedTaskPlan(started.runId, pending.planId, safeErrorMessage(error));
    }
    return this.saveGeneratedTaskPlan(
      started.runId,
      pending.planId,
      generated,
      taskAnnouncement,
      fallbackUsed,
    );
  }

  private async generateTaskPlanWithTimeout(
    input: EventTaskPlanAgentInput,
  ): Promise<EventTaskPlanAgentOutput> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.dependencies.generateTaskPlan
          ? this.dependencies.generateTaskPlan(input)
          : fallbackTaskPlan(input),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Task generation timed out. Please try again.")),
            TASK_PLAN_GENERATION_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async saveGeneratedTaskPlan(
    runId: string,
    planId: string,
    generated: EventTaskPlan,
    taskAnnouncement: string,
    fallbackUsed: boolean,
  ): Promise<EventCoordinationState> {
    while (true) {
      const current = await this.requireState(runId);
      const pending = current.taskPlans.find((plan) => plan.planId === planId);
      if (!pending || pending.status !== "generation_pending") return current;
      const persistedAt = new Date().toISOString();
      try {
        return await this.dependencies.store.saveEventCoordinationState({
          ...current,
          taskPlans: current.taskPlans.map((plan) => plan.planId === planId ? generated : plan),
          threads: current.threads.map((thread) => ({
            ...thread,
            revision: thread.revision + 1,
            messages: [...thread.messages, {
              messageId: `message_${randomUUID()}`,
              role: "system" as const,
              body: taskAnnouncement,
              kind: "change_card" as const,
              createdAt: persistedAt,
            }],
            updatedAt: persistedAt,
          })),
          groupThread: current.groupThread ? {
            ...current.groupThread,
            revision: current.groupThread.revision + 1,
            messages: [...current.groupThread.messages, {
              messageId: `message_${randomUUID()}`,
              senderId: null,
              role: "system" as const,
              body: taskAnnouncement,
              kind: "change_card" as const,
              createdAt: persistedAt,
            }],
            updatedAt: persistedAt,
          } : null,
          revision: current.revision + 1,
          auditEvents: [...current.auditEvents, this.auditEvent(current, "task_plan_generated", null, null, {
            planId: generated.planId,
            taskCount: generated.tasks.length,
            fallbackUsed,
          }, current.lifecycle)],
          updatedAt: persistedAt,
        }, current.revision);
      } catch (error) {
        if (!this.isQuestStateConflict(error)) throw error;
      }
    }
  }

  private isQuestStateConflict(error: unknown): boolean {
    return error instanceof Error && error.message.startsWith("Quest state conflict;");
  }

  private async saveFailedTaskPlan(
    runId: string,
    planId: string,
    generationError: string,
  ): Promise<EventCoordinationState> {
    while (true) {
      const current = await this.requireState(runId);
      const pending = current.taskPlans.find((plan) => plan.planId === planId);
      if (!pending || pending.status !== "generation_pending") return current;
      const now = new Date().toISOString();
      const failed: EventTaskPlan = {
        ...pending,
        status: "generation_failed",
        generationError,
        updatedAt: now,
      };
      try {
        return await this.dependencies.store.saveEventCoordinationState({
          ...current,
          taskPlans: current.taskPlans.map((plan) => plan.planId === planId ? failed : plan),
          revision: current.revision + 1,
          auditEvents: [...current.auditEvents, this.auditEvent(current, "task_plan_generation_failed", null, null, {
            planId,
          }, current.lifecycle)],
          updatedAt: now,
        }, current.revision);
      } catch (error) {
        if (!this.isQuestStateConflict(error)) throw error;
      }
    }
  }

  async retryTaskPlan(input: {
    runId: string;
    actorId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.processedCommands.includes(input.idempotencyKey)) return current;
    if (current.initiatorId !== input.actorId) throw new Error("Only the event organizer can retry task generation");
    if (current.revision !== input.expectedRevision) throw new Error("Quest state conflict; reload and retry");
    const latest = [...(current.taskPlans ?? [])].at(-1);
    if (!latest || latest.status !== "generation_failed") throw new Error("This event has no failed task plan to retry");
    const reset = await this.dependencies.store.saveEventCoordinationState({
      ...current,
      taskPlans: current.taskPlans.map((plan) => plan.planId === latest.planId
        ? { ...plan, status: "superseded" as const, updatedAt: new Date().toISOString() }
        : plan),
      revision: current.revision + 1,
      auditEvents: [...current.auditEvents, this.auditEvent(current, "task_plan_retry", input.actorId, input.idempotencyKey, {
        planId: latest.planId,
      }, current.lifecycle)],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: new Date().toISOString(),
    }, current.revision);
    return this.ensureTaskPlan(reset);
  }

  async respondToRole(input: {
    runId: string;
    actorId: string;
    action: "acknowledge" | "raise_concern";
    concern?: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.processedCommands.includes(input.idempotencyKey)) return current;
    if (current.revision !== input.expectedRevision) throw new Error("Quest state conflict; reload and retry");
    const plan = this.latestTaskPlan(current);
    if (!plan || ["generation_pending", "generation_failed", "suspended", "superseded"].includes(plan.status)) {
      throw new Error("The event task plan is not ready yet");
    }
    const role = plan.roles.find((candidate) => candidate.userId === input.actorId);
    if (!role) throw new Error("Only an active participant can respond to a role");
    if (input.action === "raise_concern" && current.lifecycle !== "scheduled") {
      throw new Error("Role changes are only available before the activity starts");
    }
    const now = new Date().toISOString();
    const nextRole = input.action === "acknowledge"
      ? { ...role, status: "acknowledged" as const, concern: null, acknowledgedAt: now, updatedAt: now }
      : { ...role, status: "concern_raised" as const, concern: input.concern?.trim() || "This role needs to be adjusted.", acknowledgedAt: null, updatedAt: now };
    const replacementRequests = input.action === "raise_concern"
      ? await Promise.all(plan.tasks
        .filter((task) => task.assignees.some((assignee) => assignee.userId === input.actorId)
          && !plan.reassignments.some((request) => request.taskId === task.taskId && request.requesterId === input.actorId && request.status === "pending_admin"))
        .map(async (task) => {
          const participant = stateParticipant(current, input.actorId);
          const replacement = this.dependencies.proposeTaskReassignment
            ? await this.dependencies.proposeTaskReassignment({
                task,
                participant: {
                  userId: input.actorId,
                  role: role.name,
                  contributions: participant.contributions,
                },
                reason: input.concern ?? "Role needs adjustment",
              })
            : {
                title: `Alternative: ${task.title}`.slice(0, 60),
                instruction: "Choose an equivalent way to help the event.",
                difficulty: task.difficulty,
              };
          const equivalentReplacement = { ...replacement, difficulty: task.difficulty };
          return {
            requestId: `task_reassignment_${randomUUID()}`,
            taskId: task.taskId,
            requesterId: input.actorId,
            reason: input.concern?.trim() || "This role needs to be adjusted.",
            replacement: equivalentReplacement,
            status: "pending_admin" as const,
            reviewedBy: null,
            reviewedAt: null,
            reviewReason: null,
            createdAt: now,
            updatedAt: now,
          };
        }))
      : [];
    const nextPlan = this.recalculateTaskAcknowledgements({
      ...plan,
      roles: plan.roles.map((candidate) => candidate.userId === input.actorId ? nextRole : candidate),
      reassignments: [...plan.reassignments, ...replacementRequests],
      status: "awaiting_acknowledgement",
      updatedAt: now,
    });
    return this.dependencies.store.saveEventCoordinationState({
      ...current,
      taskPlans: current.taskPlans.map((candidate) => candidate.planId === plan.planId ? nextPlan : candidate),
      revision: current.revision + 1,
      auditEvents: [...current.auditEvents, this.auditEvent(current, `role_${input.action}`, input.actorId, input.idempotencyKey, {
        planId: plan.planId,
      }, current.lifecycle)],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: now,
    }, current.revision);
  }

  async actOnTask(input: {
    runId: string;
    taskId: string;
    actorId: string;
    action: "submit" | "approve" | "needs_retry" | "reverse";
    reason?: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.processedCommands.includes(input.idempotencyKey)) return current;
    if (current.revision !== input.expectedRevision) throw new Error("Quest state conflict; reload and retry");
    const plan = this.latestTaskPlan(current);
    if (!plan || plan.status !== "active") throw new Error("Tasks are not active yet");
    if (!["scheduled", "in_progress", "completed"].includes(current.lifecycle)) {
      throw new Error("Tasks are unavailable while the event arrangement is changing");
    }
    const task = plan.tasks.find((candidate) => candidate.taskId === input.taskId);
    if (!task) throw new Error("Task was not found");
    const assigneeIds = task.assignees.map((assignee) => assignee.userId);
    const isAssignee = assigneeIds.includes(input.actorId);
    const canReview = input.actorId === task.reviewerId
      && (input.actorId === current.initiatorId || this.isActiveMember(current, input.actorId));
    const now = new Date().toISOString();
    if (input.action === "submit") {
      if (!isAssignee) throw new Error("Only an assigned participant can submit this task");
      if (!["acknowledged", "needs_retry"].includes(task.status)) throw new Error("This task is not ready for submission");
      if (current.lifecycle === "completed" || current.lifecycle === "cancelled") throw new Error("This event is no longer accepting task submissions");
    } else {
      if (!canReview) throw new Error("You do not have permission to review this task");
      if (input.action === "approve" && task.status !== "submitted") throw new Error("Only submitted tasks can be approved");
      if (input.action === "needs_retry" && task.status !== "submitted") throw new Error("Only submitted tasks can be sent back");
      if (input.action === "reverse" && task.status !== "approved") throw new Error("Only approved tasks can be reversed");
      if (["needs_retry", "reverse"].includes(input.action) && !input.reason?.trim()) throw new Error("A reason is required");
    }
    const nextTask: EventTask = input.action === "submit"
      ? { ...task, status: "submitted", submittedAt: now, reviewedBy: null, reviewedAt: null, updatedAt: now }
      : input.action === "approve"
        ? { ...task, status: "approved", reviewedBy: input.actorId, reviewedAt: now, reviewReason: null, updatedAt: now }
        : { ...task, status: "needs_retry", reviewedBy: input.actorId, reviewedAt: now, reviewReason: input.reason?.trim() ?? null, updatedAt: now };
    const rewardEntries = [...(current.rewardEntries ?? [])];
    if (input.action === "approve") {
      if (rewardEntries.some((entry) => entry.taskId === task.taskId && entry.kind === "task_award")) {
        throw new Error("This task has already awarded points");
      }
      rewardEntries.push(...assigneeIds.map((userId) => ({
        entryId: `reward_${randomUUID()}`,
        userId,
        runId: current.runId,
        taskId: task.taskId,
        points: task.points,
        kind: "task_award" as const,
        reversesEntryId: null,
        actorId: input.actorId,
        reason: null,
        createdAt: now,
      })));
    }
    if (input.action === "reverse") {
      rewardEntries.push(...rewardEntries
        .filter((entry) => entry.taskId === task.taskId && entry.kind === "task_award")
        .map((entry) => ({
          entryId: `reward_${randomUUID()}`,
          userId: entry.userId,
          runId: current.runId,
          taskId: task.taskId,
          points: -entry.points,
          kind: "reversal" as const,
          reversesEntryId: entry.entryId,
          actorId: input.actorId,
          reason: input.reason?.trim() ?? null,
          createdAt: now,
        })));
    }
    return this.dependencies.store.saveEventCoordinationState({
      ...current,
      taskPlans: current.taskPlans.map((candidate) => candidate.planId === plan.planId
        ? { ...plan, tasks: plan.tasks.map((candidateTask) => candidateTask.taskId === task.taskId ? nextTask : candidateTask), updatedAt: now }
        : candidate),
      rewardEntries,
      revision: current.revision + 1,
      auditEvents: [...current.auditEvents, this.auditEvent(current, `task_${input.action}`, input.actorId, input.idempotencyKey, {
        planId: plan.planId,
        taskId: task.taskId,
        points: input.action === "approve" ? task.points : undefined,
        reason: input.reason?.trim() || undefined,
      }, current.lifecycle)],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: now,
    }, current.revision);
  }

  async listRewardEntries(userId: string): Promise<Array<{
    entryId: string;
    userId: string;
    runId: string;
    taskId: string;
    points: number;
    kind: "task_award" | "reversal";
    reversesEntryId: string | null;
    actorId: string;
    reason: string | null;
    createdAt: string;
    taskTitle: string;
    eventTitle: string;
    difficulty: "easy" | "medium" | "hard";
  }>> {
    const states = await this.dependencies.store.listEventCoordinationStates(userId);
    return states.flatMap((state) => (state.rewardEntries ?? [])
      .filter((entry) => entry.userId === userId)
      .map((entry) => {
        const task = (state.taskPlans ?? []).flatMap((plan) => plan.tasks).find((candidate) => candidate.taskId === entry.taskId);
        return {
          ...entry,
          taskTitle: task?.title ?? "Event task",
          eventTitle: state.proposal.quest.title,
          difficulty: task?.difficulty ?? "easy",
        };
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listTaskRewardRunIds(userId: string): Promise<Set<string>> {
    const states = await this.dependencies.store.listEventCoordinationStates(userId);
    return new Set(states
      .filter((state) => (state.taskPlans ?? []).some((plan) =>
        plan.status !== "superseded"
        && plan.status !== "generation_failed"
        && (plan.roles.some((role) => role.userId === userId)
          || plan.tasks.some((task) => task.assignees.some((assignee) => assignee.userId === userId)))))
      .map((state) => state.runId));
  }

  async decideTaskReassignment(input: {
    runId: string;
    requestId: string;
    actorId: string;
    action: "approve" | "reject";
    reason?: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.processedCommands.includes(input.idempotencyKey)) return current;
    if (current.initiatorId !== input.actorId) throw new Error("Only the event organizer can decide a task reassignment");
    if (current.revision !== input.expectedRevision) throw new Error("Quest state conflict; reload and retry");
    const plan = this.latestTaskPlan(current);
    const request = plan?.reassignments.find((candidate) => candidate.requestId === input.requestId);
    if (!plan || !request || request.status !== "pending_admin") throw new Error("Task reassignment was not found");
    const task = plan.tasks.find((candidate) => candidate.taskId === request.taskId);
    if (!task) throw new Error("Task was not found");
    const now = new Date().toISOString();
    const approved = input.action === "approve";
    const nextRequest = {
      ...request,
      status: approved ? "approved" as const : "rejected" as const,
      reviewedBy: input.actorId,
      reviewedAt: now,
      reviewReason: input.reason?.trim() || null,
      updatedAt: now,
    };
    const nextTask = approved && request.replacement
      ? {
          ...task,
          title: request.replacement.title,
          instruction: request.replacement.instruction,
          difficulty: request.replacement.difficulty,
          points: pointsForDifficulty(request.replacement.difficulty),
          status: "assigned" as const,
          assignees: task.assignees.map((assignee) => ({ ...assignee, acknowledgedAt: null })),
          submittedAt: null,
          reviewedBy: null,
          reviewedAt: null,
          reviewReason: null,
          updatedAt: now,
        }
      : task;
    const nextPlan = this.recalculateTaskAcknowledgements({
      ...plan,
      roles: plan.roles.map((role) => role.userId === request.requesterId
        ? { ...role, status: "pending" as const, concern: approved ? null : role.concern, acknowledgedAt: null, updatedAt: now }
        : role),
      tasks: plan.tasks.map((candidate) => candidate.taskId === task.taskId ? nextTask : candidate),
      reassignments: plan.reassignments.map((candidate) => candidate.requestId === request.requestId ? nextRequest : candidate),
      updatedAt: now,
    });
    return this.dependencies.store.saveEventCoordinationState({
      ...current,
      taskPlans: current.taskPlans.map((candidate) => candidate.planId === plan.planId ? nextPlan : candidate),
      revision: current.revision + 1,
      auditEvents: [...current.auditEvents, this.auditEvent(current, `task_reassignment_${input.action}`, input.actorId, input.idempotencyKey, {
        requestId: request.requestId,
        taskId: request.taskId,
        reason: input.reason?.trim() || undefined,
      }, current.lifecycle)],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: now,
    }, current.revision);
  }

  async listActivities(userId: string): Promise<UserEventActivities> {
    const [relatedStates, recruitingStates, hiddenSuggestionIds] = await Promise.all([
      this.dependencies.store.listEventCoordinationStates(userId),
      this.dependencies.store.listRecruitingEventCoordinationStates(),
      this.dependencies.store.listHiddenEventSuggestionIds(userId),
    ]);
    const hiddenSuggestions = new Set(hiddenSuggestionIds);
    const states = [...new Map([...relatedStates, ...recruitingStates].map((state) => [state.runId, this.withRecruitmentDefaults(state)])).values()];
    const questRuns: QuestRun[] = this.dependencies.store.findQuestRuns
      ? await this.dependencies.store.findQuestRuns(states.map((state) => state.runId))
      : (await Promise.all(states.map((state) => this.dependencies.store.findQuestRun?.(state.runId))))
          .filter((run): run is QuestRun => run !== null && run !== undefined);
    const imageUrls = new Map(questRuns.map((run) => [run.runId, run.imageUrl ?? null]));
    const result: UserEventActivities = {
      unreadCount: 0,
      groupChatUnread: {},
      notifications: [],
      suggested: [],
      invitations: [],
      sentInvitations: [],
      my: {
        awaitingCoordination: [],
        awaitingConfirmation: [],
        upcoming: [],
        completed: [],
        cancelled: [],
      },
    };
    const suggestedScores = new Map<string, number>();
    for (const state of states) {
      const userNotifications = state.notifications.filter((notification) => notification.userId === userId);
      const groupChatUnread = unreadGroupMessages(state, userId);
      if (groupChatUnread) result.groupChatUnread[state.runId] = groupChatUnread;
      const activityNotifications = userNotifications.filter((notification) => notification.kind !== "group_message");
      result.unreadCount += activityNotifications.filter((notification) => notification.readAt === null).length;
      result.notifications.push(...activityNotifications.map((notification) => ({
        ...notification,
        runId: state.runId,
      })));
      const ownJoinRequest = [...state.joinRequests].reverse().find((request) => request.applicantId === userId);
      const imageUrl = imageUrls.get(state.runId) ?? null;
      let activity = this.activityCard(state, ownJoinRequest?.status ?? null, null, imageUrl);
      if (state.lifecycle === "forming"
        && state.memberships.length === 0
        && state.initiatorId === userId) {
        result.suggested.push(activity);
      }
      if (state.lifecycle === "recruiting"
        && state.recruitment.status === "open"
        && !hiddenSuggestions.has(state.runId)) {
        const related = state.initiatorId === userId
          || state.roster.some((member) => member.userId === userId);
        const assessment = related ? null : await this.dependencies.assessRecruitmentCandidate?.(state, userId);
        const eligible = assessment?.eligible === true;
        const discoverable = related || eligible
          || (assessment?.eligible === false && assessment.discoverable);
        const viewerEligibility = related || !assessment
          ? null
          : eligible
            ? { canRequest: true, notices: [] }
            : assessment.discoverable
              ? { canRequest: false, notices: assessment.notices }
              : null;
        activity = this.activityCard(state, ownJoinRequest?.status ?? null, viewerEligibility, imageUrl);
        suggestedScores.set(
          state.runId,
          related ? 2 : assessment?.eligible ? 1 + (assessment.candidate.score ?? 0) : 0,
        );
        if (discoverable) result.suggested.push(activity);
      }
      for (const invitation of state.invitations) {
        const view = { ...invitation, activity };
        if (invitation.guestId === userId && invitation.status === "pending") result.invitations.push(view);
        if (state.initiatorId === userId) result.sentInvitations.push(view);
      }
      const membership = [...state.memberships].reverse().find((candidate) =>
        candidate.userId === userId
        && (this.isActiveMembership(candidate) || this.isTerminalMembership(candidate)));
      if (!membership) continue;
      if (membership.status === "cancelled" || state.lifecycle === "cancelled") result.my.cancelled.push(activity);
      else if (membership.status === "completed" || state.lifecycle === "completed") result.my.completed.push(activity);
      else if (membership.status === "confirmed" && ["scheduled", "in_progress"].includes(state.lifecycle)) {
        result.my.upcoming.push(activity);
      } else if (membership.status === "awaiting_confirmation" || state.lifecycle === "awaiting_confirmation") {
        result.my.awaitingConfirmation.push(activity);
      } else result.my.awaitingCoordination.push(activity);
    }
    result.suggested.sort((left, right) => (suggestedScores.get(right.runId) ?? 0) - (suggestedScores.get(left.runId) ?? 0));
    result.notifications.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    return result;
  }

  private latestTaskPlan(state: EventCoordinationState): EventTaskPlan | null {
    return [...(state.taskPlans ?? [])].reverse().find((plan) => plan.status !== "superseded") ?? null;
  }

  private isActiveMember(state: EventCoordinationState, userId: string): boolean {
    return state.memberships.some((membership) => membership.userId === userId && this.isActiveMembership(membership));
  }

  private taskPlanInput(
    state: EventCoordinationState,
    venueName: string,
    activeUserIds: string[],
  ): EventTaskPlanAgentInput {
    return {
      organizerId: state.initiatorId,
      quest: {
        title: state.proposal.quest.title,
        goal: state.proposal.quest.sharedGoal,
        description: state.proposal.quest.description,
        durationMinutes: state.proposal.quest.durationMinutes,
      },
      appointment: { venueName },
      participants: activeUserIds.map((userId) => {
        const roster = state.roster.find((member) => member.userId === userId);
        const proposal = state.proposal.proposedParticipants.find((member) => member.candidateId === userId);
        const requirements = state.threads.find((thread) => thread.userId === userId)?.confirmedRequirements;
        return {
          userId,
          proposedRole: roster?.proposedRole ?? proposal?.proposedRole ?? "supporting participant",
          contributions: proposal?.contributionsUsed ?? [],
          requirements: requirements ? [
            ...requirements.accessibility,
            ...requirements.travel,
            ...requirements.environmental,
            ...requirements.venuePreferences,
          ] : [],
        };
      }),
    };
  }

  private materializeTaskPlan(
    pending: EventTaskPlan,
    output: EventTaskPlanAgentOutput,
    now: string,
    organizerId: string,
    activeUserIds: string[],
  ): EventTaskPlan {
    return {
      ...pending,
      status: "awaiting_acknowledgement",
      roles: output.roles.map((role) => ({
        userId: role.userId,
        name: role.name,
        responsibility: role.responsibility,
        mainContribution: role.mainContribution ?? role.responsibility,
        status: "pending",
        concern: null,
        acknowledgedAt: null,
        updatedAt: now,
      })),
      tasks: output.tasks.map((task) => ({
        taskId: `task_${randomUUID()}`,
        title: task.title,
        instruction: task.instruction,
        roleUserId: task.roleUserId ?? task.assigneeIds[0],
        reviewerId: task.assigneeIds.includes(organizerId)
          ? activeUserIds.find((userId) => userId !== organizerId && !task.assigneeIds.includes(userId)) ?? organizerId
          : organizerId,
        difficulty: task.difficulty,
        points: pointsForDifficulty(task.difficulty),
        status: "assigned",
        assignees: task.assigneeIds.map((userId) => ({ userId, acknowledgedAt: null })),
        submittedAt: null,
        reviewedBy: null,
        reviewedAt: null,
        reviewReason: null,
        createdAt: now,
        updatedAt: now,
      })),
      generationError: null,
      updatedAt: now,
    };
  }

  private recalculateTaskAcknowledgements(plan: EventTaskPlan): EventTaskPlan {
    const acknowledgedUsers = new Set(plan.roles.filter((role) => role.status === "acknowledged").map((role) => role.userId));
    const tasks = plan.tasks.map((task) => ({
      ...task,
      assignees: task.assignees.map((assignee) => ({
        ...assignee,
        acknowledgedAt: acknowledgedUsers.has(assignee.userId) ? assignee.acknowledgedAt ?? new Date().toISOString() : null,
      })),
      status: task.status === "assigned" && task.assignees.every((assignee) => acknowledgedUsers.has(assignee.userId))
        ? "acknowledged" as const
        : task.status,
    }));
    const active = plan.roles.every((role) => role.status === "acknowledged")
      && tasks.every((task) => ["acknowledged", "submitted", "approved"].includes(task.status));
    return { ...plan, tasks, status: active ? "active" : "awaiting_acknowledgement" };
  }

  async listCoordinationConversations(userId: string): Promise<Array<{
    id: string;
    type: "quest_private" | "quest_group";
    title: string;
    imageUrl: string | null;
    preview: string;
    lastMessageAt: string;
    unreadCount: number;
    memberCount: number;
    questId: string;
    canLeave: false;
    canDelete: false;
  }>> {
    const states = await this.dependencies.store.listEventCoordinationStates(userId);
    return states.flatMap((rawState) => {
      const state = this.withRecruitmentDefaults(rawState);
      if (!this.canCoordinate(state, userId)) return [];
      const activeMembers = state.memberships.filter((membership) => this.isActiveMembership(membership));
      const privateThread = state.threads.find((thread) => thread.userId === userId);
      const privateSummary = privateThread ? [{
        id: `quest-private:${state.runId}`,
        type: "quest_private" as const,
        title: `${state.proposal.quest.title} · Private`,
        imageUrl: null,
        preview: privateThread.messages.at(-1)?.body ?? "Private coordination with Senior Quest",
        lastMessageAt: privateThread.messages.at(-1)?.createdAt ?? privateThread.updatedAt,
        unreadCount: 0,
        memberCount: 1,
        questId: state.runId,
        canLeave: false as const,
        canDelete: false as const,
      }] : [];
      const groupSummary = state.groupThread && activeMembers.length >= 2 ? [{
        id: `quest-group:${state.runId}`,
        type: "quest_group" as const,
        title: state.proposal.quest.title,
        imageUrl: "/assets/profile-group.jpg",
        preview: state.groupThread.messages.at(-1)?.body ?? "Shared activity chat",
        lastMessageAt: state.groupThread.messages.at(-1)?.createdAt ?? state.groupThread.updatedAt,
        unreadCount: unreadGroupMessages(state, userId),
        memberCount: activeMembers.length,
        questId: state.runId,
        canLeave: false as const,
        canDelete: false as const,
      }] : [];
      return [...privateSummary, ...groupSummary];
    }).sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt));
  }

  private activityCard(
    state: EventCoordinationState,
    viewerRequestStatus: EventJoinRequest["status"] | null = null,
    viewerEligibility: EventRecruitmentViewerEligibility | null = null,
    imageUrl: string | null = null,
  ): EventActivityCard {
    const finalized = [...state.arrangements].reverse().find((arrangement) => arrangement.status === "finalized");
    const working = [...state.arrangements].reverse().find((arrangement) => arrangement.status === "awaiting_participant_confirmation");
    return {
      runId: state.runId,
      ...(imageUrl ? { imageUrl } : {}),
      title: state.proposal.quest.title,
      description: state.proposal.quest.description,
      lifecycle: state.lifecycle,
      durationMinutes: state.proposal.quest.durationMinutes,
      timeZone: state.timeZone,
      provisionalAvailability: state.proposal.quest.proposedTimeWindow ?? null,
      workingArrangement: working ? {
        start: working.start,
        end: working.end,
        venueName: working.venueName,
        version: working.version,
      } : null,
      finalArrangement: finalized ? {
        start: finalized.start,
        end: finalized.end,
        venueName: finalized.venueName,
        version: finalized.version,
      } : null,
      recruitment: state.recruitment.status === "closed" && state.recruitment.publishedAt === null
        ? null
        : {
            ...state.recruitment,
            currentApprovedCount: state.roster.length,
            viewerRequestStatus,
            viewerEligibility,
          },
    };
  }

  private basicRosterValidation(proposal: QuestProposal): ValidationResult {
    const ids = proposal.proposedParticipants.map((participant) => participant.candidateId);
    const errors: ValidationResult["errors"] = [];
    if (ids.length < 2 || ids.length > 5) errors.push({
      field: "groupSize",
      message: "A quest requires between two and five people.",
    });
    if (new Set(ids).size !== ids.length) errors.push({
      field: "proposedParticipants",
      message: "Proposed participants must be unique.",
    });
    return { valid: errors.length === 0, errors };
  }

  private hasOnlyGroupSizeErrors(validation: ValidationResult): boolean {
    return validation.errors.length > 0 && validation.errors.every((error) => error.field === "groupSize");
  }

  private canEnterFormation(run: QuestRun): boolean {
    if (!run.proposal || !run.validation || run.safety?.status !== "approved") return false;
    if (run.validation.valid) return true;
    return run.proposal.proposedParticipants.length >= 1
      && run.proposal.proposedParticipants.some((participant) => participant.candidateId === run.initiatingCandidateId)
      && this.hasOnlyGroupSizeErrors(run.validation);
  }

  private withRecruitmentDefaults(state: EventCoordinationState): EventCoordinationState {
    const currentGroupSize = state.roster.length;
    return {
      ...state,
      timeZone: state.timeZone ?? "Asia/Singapore",
      groupThread: state.groupThread
        ? { ...state.groupThread, visibleAppointmentVersion: state.groupThread.visibleAppointmentVersion ?? null }
        : null,
      threads: state.threads.map((thread) => ({
        ...thread,
        visibleAppointmentVersion: thread.visibleAppointmentVersion ?? null,
      })),
      taskPlans: state.taskPlans ?? [],
      rewardEntries: state.rewardEntries ?? [],
      appointmentSuggestions: state.appointmentSuggestions ?? [],
      recruitment: state.recruitment ?? {
        status: "closed",
        minimumGroupSize: Math.max(2, currentGroupSize),
        targetGroupSize: Math.max(2, currentGroupSize),
        maximumGroupSize: Math.max(2, currentGroupSize),
        publishedAt: null,
      },
      joinRequests: state.joinRequests ?? [],
    };
  }

  private isActiveMembership(membership: EventMembership): boolean {
    return !["withdrawn", "replaced", "cancelled", "completed"].includes(membership.status);
  }

  private isTerminalMembership(membership: EventMembership): boolean {
    return membership.status === "completed" || membership.status === "cancelled";
  }

  private canCoordinate(state: EventCoordinationState, userId: string): boolean {
    if (state.initiatorId === userId) return true;
    return state.memberships.some((membership) => membership.userId === userId && this.isActiveMembership(membership));
  }

  private canViewCoordination(state: EventCoordinationState, userId: string): boolean {
    if (this.canCoordinate(state, userId)) return true;
    return state.invitations.some((invitation) => invitation.guestId === userId && invitation.status === "pending");
  }

  private canUseGroupCoordination(state: EventCoordinationState, userId: string): boolean {
    const activeMemberships = state.memberships.filter((membership) => this.isActiveMembership(membership));
    return activeMemberships.length >= 2 && activeMemberships.some((membership) => membership.userId === userId);
  }

  private hasAvailabilityUpdate(requirements: Partial<CoordinationRequirements> | null | undefined): boolean {
    if (!requirements) return false;
    return Object.prototype.hasOwnProperty.call(requirements, "availableWindows")
      || Object.prototype.hasOwnProperty.call(requirements, "temporaryConflicts");
  }

  private emptyRequirements(): CoordinationRequirements {
    return {
      availableWindows: [],
      accessibility: [],
      travel: [],
      dietary: [],
      environmental: [],
      venuePreferences: [],
      temporaryConflicts: [],
      other: [],
    };
  }

  private displayMember(userId: string): string {
    void userId;
    return "Community member";
  }

  private materialChanges(
    previous: EventArrangement | undefined,
    next: { start: string; end: string; venueName: string },
  ): string[] {
    if (!previous) return [];
    const changes: string[] = [];
    if (previous.start !== new Date(next.start).toISOString()) changes.push("date_or_time");
    if (previous.venueName !== next.venueName.trim()) changes.push("venue");
    const oldDuration = Date.parse(previous.end) - Date.parse(previous.start);
    const newDuration = Date.parse(next.end) - Date.parse(next.start);
    if (Math.abs(newDuration - oldDuration) > 15 * 60_000) changes.push("duration");
    return changes;
  }

  private resolveAppointmentIntentPatch(
    current: EventCoordinationState,
    intent: Extract<CoordinationIntent, { type: "change_appointment" }>,
    now: string,
  ): { patch: import("@/server/domain/event-coordination").AppointmentPatch; suggestionId: string | null } {
    if (!intent.referencesSuggestionId) return { patch: intent.patch, suggestionId: null };
    const candidates = current.appointmentSuggestions.filter((suggestion) =>
      suggestion.status === "offered" && Date.parse(suggestion.expiresAt) > Date.parse(now));
    const suggestion = intent.referencesSuggestionId === "latest"
      ? candidates.at(-1)
      : candidates.find((candidate) => candidate.suggestionId === intent.referencesSuggestionId);
    if (!suggestion) throw new Error("That suggested option is no longer available; ask me to find another one");
    return {
      suggestionId: suggestion.suggestionId,
      patch: {
        start: suggestion.alternative.start,
        end: suggestion.alternative.end,
        venueName: suggestion.alternative.venueName,
        venueAddress: suggestion.alternative.venueAddress,
      },
    };
  }

  private async answerCoordinationQuestion(
    current: EventCoordinationState,
    topic: "status" | "confirmations" | "compatibility" | "other",
  ): Promise<string> {
    const appointment = [...current.arrangements].reverse().find((arrangement) =>
      arrangement.status === "awaiting_participant_confirmation" || arrangement.status === "finalized");
    if (topic === "confirmations") {
      if (!appointment) {
        const pendingInvitees = current.invitations.filter((invitation) => invitation.status === "pending");
        if (!pendingInvitees.length) return "Everyone has responded. The group can now choose a working appointment.";
        const names = await Promise.all(pendingInvitees.map(async (invitation) =>
          (await this.dependencies.resolveMember?.(invitation.guestId))?.displayName ?? this.displayMember(invitation.guestId)));
        return `Still waiting for ${names.join(", ")} to respond to the invitation.`;
      }
      const pending = appointment.confirmations.filter((confirmation) => confirmation.status === "pending");
      if (!pending.length) return `Everyone confirmed appointment version ${appointment.version}.`;
      const names = await Promise.all(pending.map(async (confirmation) =>
        (await this.dependencies.resolveMember?.(confirmation.userId))?.displayName ?? this.displayMember(confirmation.userId)));
      return `Appointment version ${appointment.version} is waiting for confirmation from ${names.join(", ")}.`;
    }
    if (appointment?.status === "finalized") {
      return `The appointment is final: ${formatAppointmentInstant(appointment.start, current.timeZone)} at ${appointment.venueName}.`;
    }
    if (appointment) {
      return `The current working appointment is ${formatAppointmentInstant(appointment.start, current.timeZone)} at ${appointment.venueName}, and it is waiting for confirmations.`;
    }
    return "The activity is still being coordinated. The displayed time is availability, not a final appointment.";
  }

  private prepareOrganizerAction(
    current: EventCoordinationState,
    actorId: string,
    intent: Extract<CoordinationIntent, { type: "organizer_action" }>,
    now: string,
  ): {
    reply: string;
    mutation: null | {
      lifecycle: EventCoordinationState["lifecycle"];
      invitations: EventInvitation[];
      memberships: EventMembership[];
      arrangements: EventArrangement[];
      notifications: EventCoordinationState["notifications"];
      newNotifications: EventCoordinationState["notifications"];
      outbox: EventCoordinationState["outbox"];
    };
  } {
    if (current.initiatorId !== actorId) {
      return { reply: "Only the organizer can change the roster or activity lifecycle.", mutation: null };
    }
    if (intent.action === "change_roster") {
      return { reply: "Open Activity details to specify who should be added, removed, or replaced.", mutation: null };
    }
    const allowed = intent.action === "cancel"
      ? !["cancelled", "completed"].includes(current.lifecycle)
      : intent.action === "start"
        ? current.lifecycle === "scheduled"
        : current.lifecycle === "in_progress";
    if (!allowed) return { reply: `The activity cannot be ${intent.action === "complete" ? "completed" : `${intent.action}ed`} from its current state.`, mutation: null };
    const lifecycle = intent.action === "cancel"
      ? "cancelled" as const
      : intent.action === "start" ? "in_progress" as const : "completed" as const;
    const invitations = intent.action === "cancel"
      ? current.invitations.map((invitation): EventInvitation => ["pending", "accepted"].includes(invitation.status)
        ? { ...invitation, status: "cancelled", version: invitation.version + 1, deliveryState: invitation.deliveryState === "pending" ? "cancelled" : invitation.deliveryState, updatedAt: now }
        : invitation)
      : current.invitations;
    const memberships = current.memberships.map((membership): EventMembership => this.isActiveMembership(membership)
      ? { ...membership, status: intent.action === "cancel" ? "cancelled" : intent.action === "complete" ? "completed" : membership.status, updatedAt: now }
      : membership);
    const arrangements = intent.action === "cancel"
      ? current.arrangements.map((arrangement): EventArrangement => ["proposed", "initiator_approved", "awaiting_participant_confirmation", "finalized"].includes(arrangement.status)
        ? { ...arrangement, status: "superseded", updatedAt: now }
        : arrangement)
      : current.arrangements;
    const recipients = [...new Set([
      ...current.memberships.map((membership) => membership.userId),
      ...current.invitations.filter((invitation) => invitation.status === "pending").map((invitation) => invitation.guestId),
    ])].filter((userId) => userId !== actorId);
    const newNotifications = recipients.map((userId) => ({
      notificationId: `notification_${randomUUID()}`,
      userId,
      kind: intent.action === "cancel" ? "cancellation" as const : "change" as const,
      title: intent.action === "cancel" ? "Activity cancelled" : intent.action === "start" ? "Activity started" : "Activity completed",
      body: current.proposal.quest.title,
      readAt: null,
      deduplicationKey: `quest-${intent.action}:${current.runId}:${current.revision + 1}:${userId}`,
      createdAt: now,
    }));
    const outbox = intent.action === "cancel"
      ? current.outbox.map((job) => job.status === "pending"
        ? { ...job, status: "cancelled" as const, updatedAt: now }
        : job)
      : current.outbox;
    return {
      reply: intent.action === "cancel"
        ? `The activity “${current.proposal.quest.title}” is cancelled. Everyone affected has been notified.`
        : intent.action === "start" ? "The activity is now marked in progress." : "The activity is now marked completed.",
      mutation: {
        lifecycle,
        invitations,
        memberships,
        arrangements,
        notifications: [...current.notifications, ...newNotifications],
        newNotifications,
        outbox,
      },
    };
  }

  private async prepareAppointmentChange(
    current: EventCoordinationState,
    actorId: string,
    patch: import("@/server/domain/event-coordination").AppointmentPatch,
    sourceMessageId: string,
    now: string,
  ): Promise<{
    arrangements: EventArrangement[];
    memberships: EventMembership[];
    notifications: EventCoordinationState["notifications"];
    newNotifications: EventCoordinationState["notifications"];
    lifecycle: "awaiting_confirmation";
    version: number;
    reply: string;
    broadcastKind: "change_card";
  }> {
    const actorMembership = current.memberships.find((membership) =>
      membership.userId === actorId && this.isActiveMembership(membership));
    if (!actorMembership) throw new Error("Only an accepted participant can change the appointment");
    const previous = [...current.arrangements].reverse().find((arrangement) =>
      ["proposed", "initiator_approved", "awaiting_participant_confirmation", "finalized"].includes(arrangement.status));
    const provisional = current.proposal.quest.proposedTimeWindow;
    let start = patch.start ? new Date(patch.start).toISOString() : previous?.start ?? provisional.start;
    if (patch.localTime) start = localTimeOnCurrentDate(start, patch.localTime, current.timeZone);
    const existingDuration = previous
      ? (Date.parse(previous.end) - Date.parse(previous.start)) / 60_000
      : current.proposal.quest.durationMinutes;
    const durationMinutes = patch.durationMinutes ?? existingDuration;
    const end = patch.end
      ? new Date(patch.end).toISOString()
      : new Date(Date.parse(start) + durationMinutes * 60_000).toISOString();
    const venueName = patch.venueName?.trim()
      || previous?.venueName
      || "Community venue (opening hours to verify)";
    if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) {
      throw new Error("The requested appointment time could not be resolved");
    }
    const validation = await this.dependencies.validateArrangement?.({
      state: current,
      start,
      end,
      venueName,
    });
    if (validation && !validation.valid) {
      const alternative = await this.dependencies.suggestArrangement?.(current, { start, end, venueName }) ?? null;
      const alternativeValidation = alternative ? await this.dependencies.validateArrangement?.({
        state: current,
        start: alternative.start,
        end: alternative.end,
        venueName: alternative.venueName,
      }) : null;
      throw new AppointmentIncompatibleError(alternative && alternativeValidation?.valid !== false ? alternative : null);
    }
    const version = (current.arrangements.at(-1)?.version ?? 0) + 1;
    const confirmations = current.memberships
      .filter((membership) => this.isActiveMembership(membership))
      .map((membership) => ({ userId: membership.userId, status: "pending" as const, respondedAt: null }));
    const materialChanges = this.materialChanges(previous, { start, end, venueName });
    const arrangement: EventArrangement = {
      arrangementId: `arrangement_${randomUUID()}`,
      version,
      start,
      end,
      venueName,
      venueAddress: patch.venueAddress === undefined ? previous?.venueAddress ?? null : patch.venueAddress,
      venueStatus: "proposed",
      status: "awaiting_participant_confirmation",
      materialChanges,
      confirmations,
      createdAt: now,
      updatedAt: now,
    };
    const arrangements = current.arrangements.map((candidate): EventArrangement =>
      ["proposed", "initiator_approved", "awaiting_participant_confirmation", "finalized"].includes(candidate.status)
        ? { ...candidate, status: "superseded", updatedAt: now }
        : candidate);
    const memberships = current.memberships.map((membership) => this.isActiveMembership(membership)
      ? { ...membership, status: "awaiting_confirmation" as const, updatedAt: now }
      : membership);
    const newNotifications = current.memberships
      .filter((membership) => this.isActiveMembership(membership))
      .map((membership) => ({
        notificationId: `notification_${randomUUID()}`,
        userId: membership.userId,
        kind: "change" as const,
        title: "Confirm the updated appointment",
        body: `${venueName} · ${formatAppointmentInstant(start, current.timeZone)}`,
        readAt: null,
        deduplicationKey: `appointment-change:${current.runId}:${version}:${membership.userId}`,
        createdAt: now,
      }));
    const actor = await this.dependencies.resolveMember?.(actorId);
    const actorName = actor?.displayName ?? this.displayMember(actorId);
    return {
      arrangements: [...arrangements, arrangement],
      memberships,
      notifications: [...current.notifications, ...newNotifications],
      newNotifications,
      lifecycle: "awaiting_confirmation",
      version,
      reply: `${actorName} updated the working appointment to ${formatAppointmentInstant(start, current.timeZone)} at ${venueName}. Everyone needs to confirm version ${version}.`,
      broadcastKind: "change_card",
    };
  }

  private prepareAppointmentConflict(
    current: EventCoordinationState,
    patch: import("@/server/domain/event-coordination").AppointmentPatch,
    sourceMessageId: string,
    error: AppointmentIncompatibleError,
    now: string,
  ): { suggestion: EventAppointmentSuggestion | null; reply: string } {
    if (!error.alternative) {
      return {
        suggestion: null,
        reply: "That request does not work for the whole group, and I could not find a compatible alternative yet. Try a broader time or venue preference.",
      };
    }
    const suggestion: EventAppointmentSuggestion = {
      suggestionId: `suggestion_${randomUUID()}`,
      runId: current.runId,
      basedOnRevision: current.revision,
      sourceMessageId,
      requestedPatch: structuredClone(patch),
      alternative: structuredClone(error.alternative),
      publicReasonCategories: ["group_compatibility"],
      status: "offered",
      expiresAt: new Date(Date.parse(now) + 24 * 60 * 60_000).toISOString(),
      createdAt: now,
    };
    return {
      suggestion,
      reply: `That request does not work for the whole group. The closest compatible option is ${formatAppointmentInstant(suggestion.alternative.start, current.timeZone)} at ${suggestion.alternative.venueName}. You can say “use that option” to apply it.`,
    };
  }

  private prepareAppointmentConfirmation(
    current: EventCoordinationState,
    actorId: string,
    actorName: string,
    requestedVersion: number | null,
    now: string,
  ): {
    arrangements: EventArrangement[];
    memberships: EventMembership[];
    notifications: EventCoordinationState["notifications"];
    newNotifications: EventCoordinationState["notifications"];
    lifecycle: "awaiting_confirmation" | "scheduled";
    version: number;
    reply: string;
    broadcastKind: "arrangement_card";
  } {
    const membership = current.memberships.find((candidate) =>
      candidate.userId === actorId && this.isActiveMembership(candidate));
    if (!membership) throw new Error("Only an accepted participant can confirm the appointment");
    if (current.invitations.some((invitation) => invitation.status === "pending")) {
      throw new Error("Wait for every invitation response before finalizing the appointment");
    }
    const target = [...current.arrangements].reverse().find((arrangement) =>
      arrangement.status === "awaiting_participant_confirmation");
    if (!target) throw new Error("There is no working appointment awaiting confirmation");
    if (requestedVersion === null || requestedVersion !== target.version) {
      throw new Error("That confirmation refers to an older appointment version");
    }
    const ownConfirmation = target.confirmations.find((confirmation) => confirmation.userId === actorId);
    if (!ownConfirmation) throw new Error("You are not included in this appointment version");
    if (ownConfirmation.status === "confirmed") throw new Error("You have already confirmed this appointment version");
    const confirmations = target.confirmations.map((confirmation) => confirmation.userId === actorId
      ? { ...confirmation, status: "confirmed" as const, respondedAt: now }
      : confirmation);
    const finalized = confirmations.every((confirmation) => confirmation.status === "confirmed");
    const updatedTarget: EventArrangement = {
      ...target,
      confirmations,
      status: finalized ? "finalized" : "awaiting_participant_confirmation",
      venueStatus: finalized ? "participant_confirmed" : target.venueStatus,
      updatedAt: now,
    };
    const memberships = current.memberships.map((candidate) => this.isActiveMembership(candidate)
      ? { ...candidate, status: finalized ? "confirmed" as const : "awaiting_confirmation" as const, updatedAt: now }
      : candidate);
    const newNotifications = finalized
      ? current.memberships.filter((candidate) => this.isActiveMembership(candidate)).map((candidate) => ({
          notificationId: `notification_${randomUUID()}`,
          userId: candidate.userId,
          kind: "arrangement" as const,
          title: "Your appointment is final",
          body: `${target.venueName} · ${formatAppointmentInstant(target.start, current.timeZone)}`,
          readAt: null,
          deduplicationKey: `appointment-finalized:${current.runId}:${target.version}:${candidate.userId}`,
          createdAt: now,
        }))
      : current.memberships.filter((candidate) => this.isActiveMembership(candidate) && candidate.userId !== actorId).map((candidate) => ({
          notificationId: `notification_${randomUUID()}`,
          userId: candidate.userId,
          kind: "arrangement" as const,
          title: `${actorName} confirmed the plan`,
          body: `Appointment version ${target.version} is still waiting for the rest of the group.`,
          readAt: null,
          deduplicationKey: `appointment-confirmed:${current.runId}:${target.version}:${actorId}:${candidate.userId}`,
          createdAt: now,
        }));
    const remaining = confirmations.filter((confirmation) => confirmation.status !== "confirmed").length;
    return {
      arrangements: current.arrangements.map((arrangement) =>
        arrangement.arrangementId === target.arrangementId ? updatedTarget : arrangement),
      memberships,
      notifications: [...current.notifications, ...newNotifications],
      newNotifications,
      lifecycle: finalized ? "scheduled" : "awaiting_confirmation",
      version: target.version,
      reply: finalized
        ? `The appointment is final: ${formatAppointmentInstant(target.start, current.timeZone)} at ${target.venueName}.`
        : `Your confirmation is recorded for version ${target.version}. ${remaining} ${remaining === 1 ? "person still needs" : "people still need"} to confirm.`,
      broadcastKind: "arrangement_card",
    };
  }

  private prepareAppointmentRejection(
    current: EventCoordinationState,
    actorId: string,
    actorName: string,
    visibleVersion: number | null,
    now: string,
  ): {
    arrangements: EventArrangement[];
    memberships: EventMembership[];
    notifications: EventCoordinationState["notifications"];
    newNotifications: EventCoordinationState["notifications"];
    lifecycle: "coordinating";
    version: number;
    reply: string;
    broadcastKind: "arrangement_card";
  } {
    const membership = current.memberships.find((candidate) =>
      candidate.userId === actorId && this.isActiveMembership(candidate));
    if (!membership) throw new Error("Only an accepted participant can reject the appointment");
    const target = [...current.arrangements].reverse().find((arrangement) =>
      arrangement.status === "awaiting_participant_confirmation");
    if (!target) throw new Error("There is no working appointment awaiting a response");
    if (visibleVersion === null || visibleVersion !== target.version) {
      throw new Error("That response refers to an older appointment version");
    }
    const actor = target.confirmations.find((confirmation) => confirmation.userId === actorId);
    if (!actor) throw new Error("You are not included in this appointment version");
    const confirmations = target.confirmations.map((confirmation) => confirmation.userId === actorId
      ? { ...confirmation, status: "rejected" as const, respondedAt: now }
      : confirmation);
    const updatedTarget: EventArrangement = {
      ...target,
      confirmations,
      status: "rejected",
      updatedAt: now,
    };
    const memberships = current.memberships.map((candidate) => this.isActiveMembership(candidate)
      ? { ...candidate, status: "coordinating" as const, updatedAt: now }
      : candidate);
    const newNotifications = current.memberships.filter((candidate) =>
      this.isActiveMembership(candidate) && candidate.userId !== actorId).map((candidate) => ({
      notificationId: `notification_${randomUUID()}`,
      userId: candidate.userId,
      kind: "change" as const,
      title: "Appointment needs another option",
      body: `${actorName} cannot confirm appointment version ${target.version}.`,
      readAt: null,
      deduplicationKey: `appointment-rejected:${current.runId}:${target.version}:${actorId}:${candidate.userId}`,
      createdAt: now,
    }));
    return {
      arrangements: current.arrangements.map((arrangement) =>
        arrangement.arrangementId === target.arrangementId ? updatedTarget : arrangement),
      memberships,
      notifications: [...current.notifications, ...newNotifications],
      newNotifications,
      lifecycle: "coordinating",
      version: target.version,
      reply: `${actorName} cannot confirm appointment version ${target.version}. The group needs another compatible option.`,
      broadcastKind: "arrangement_card",
    };
  }

  private auditEvent(
    current: EventCoordinationState,
    type: string,
    actorId: string | null,
    idempotencyKey: string | null,
    safeDiff: Record<string, unknown>,
    newLifecycle: EventCoordinationState["lifecycle"],
  ) {
    return {
      eventId: `event_${randomUUID()}`,
      type,
      actorId,
      aggregateRevision: current.revision + 1,
      previousLifecycle: current.lifecycle,
      newLifecycle,
      idempotencyKey,
      safeDiff,
      createdAt: new Date().toISOString(),
    };
  }

  private async requireState(runId: string): Promise<EventCoordinationState> {
    const state = await this.dependencies.store.findEventCoordinationState(runId);
    if (!state) throw new Error("Event coordination state was not found");
    return this.withRecruitmentDefaults(state);
  }
}

class AppointmentIncompatibleError extends Error {
  constructor(readonly alternative: {
    start: string;
    end: string;
    venueName: string;
    venueAddress: string | null;
  } | null) {
    super("The requested appointment is incompatible with confirmed group requirements");
    this.name = "AppointmentIncompatibleError";
  }
}

function localTimeOnCurrentDate(currentInstant: string, localTime: string, timeZone: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!match) throw new Error("Use a valid local time in HH:mm format");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("Use a valid local time in HH:mm format");
  const dateParts = zonedParts(new Date(currentInstant), timeZone);
  const desiredWallClock = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute);
  let guess = desiredWallClock;
  // Two passes handle offsets whose DST state differs between the initial UTC
  // guess and the resulting local instant.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = zonedParts(new Date(guess), timeZone);
    const representedWallClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    guess += desiredWallClock - representedWallClock;
  }
  return new Date(guess).toISOString();
}

function zonedParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}

function formatAppointmentInstant(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(instant));
}

function fallbackTaskPlan(input: EventTaskPlanAgentInput): EventTaskPlanAgentOutput {
  const humanize = (role: string) => {
    const text = role.replaceAll("_", " ").trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Quest helper";
  };
  const roles = input.participants.map((participant) => {
    const contribution = participant.contributions.find((item) => item.trim())?.trim();
    return {
      userId: participant.userId,
      name: humanize(participant.proposedRole).slice(0, 40),
      responsibility: `${humanize(participant.proposedRole)}: ${contribution ?? "help the group"}`.slice(0, 120),
      mainContribution: (contribution ?? "Help welcome and support the group").slice(0, 120),
    };
  });
  const tasks = input.participants.map((participant, index) => ({
    title: `Participant task ${index + 1}`,
    instruction: "Complete your assigned event responsibility at the event venue and tell the group when it is done.",
    roleUserId: participant.userId,
    difficulty: index === 0 ? "medium" as const : "easy" as const,
    assigneeIds: [participant.userId],
  }));
  while (tasks.length < 3) {
    tasks.push({
      title: `Group support task ${tasks.length + 1}`,
      instruction: "Complete this event support step at the event venue and tell the group when it is done.",
      roleUserId: input.participants[0].userId,
      difficulty: "easy",
      assigneeIds: [input.participants[0].userId],
    });
  }
  return eventTaskPlanAgentOutputSchema.parse({ roles, tasks: tasks.slice(0, 5) });
}

function stateParticipant(state: EventCoordinationState, userId: string): { contributions: string[] } {
  return {
    contributions: state.proposal.proposedParticipants.find((participant) => participant.candidateId === userId)?.contributionsUsed ?? [],
  };
}

function unreadGroupMessages(state: EventCoordinationState, userId: string): number {
  return state.notifications.filter((notification) =>
    notification.userId === userId
    && notification.kind === "group_message"
    && notification.readAt === null).length;
}
