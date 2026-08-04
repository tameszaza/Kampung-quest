import { randomUUID } from "node:crypto";
import type { Participant, QuestProposal, QuestRun, ValidationResult } from "@/server/domain/schemas";
import type {
  CoordinationRequirements,
  EventArrangement,
  EventActivityCard,
  EventCoordinationThread,
  EventCoordinationState,
  EventInvitation,
  EventMembership,
  EventNotification,
  EventNotificationView,
  EventOutboxJob,
  EventQuestView,
  EventRosterMember,
  UserEventActivities,
} from "@/server/domain/event-coordination";

export interface EventCoordinationStore {
  createEventCoordinationState(state: EventCoordinationState): Promise<EventCoordinationState>;
  findEventCoordinationState(runId: string): Promise<EventCoordinationState | null>;
  saveEventCoordinationState(
    state: EventCoordinationState,
    expectedRevision: number,
  ): Promise<EventCoordinationState>;
  listEventCoordinationStates(userId: string): Promise<EventCoordinationState[]>;
  listQuestRuns(candidateId: string, limit: number): Promise<QuestRun[]>;
  syncQuestProposal?(runId: string, proposal: QuestProposal): Promise<void>;
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
  validateRoster?: (proposal: QuestProposal) => Promise<ValidationResult>;
  validateArrangement?: (input: {
    state: EventCoordinationState;
    start: string;
    end: string;
    venueName: string;
  }) => Promise<ValidationResult>;
  suggestArrangement?: (state: EventCoordinationState) => Promise<{
    start: string;
    end: string;
    venueName: string;
    venueAddress: string | null;
  } | null>;
  coordinate?: (input: {
    state: EventCoordinationState;
    thread: EventCoordinationThread;
    message: string;
  }) => Promise<{
    reply: string;
    requirementPatch?: Partial<CoordinationRequirements>;
  }>;
}

export class EventCoordinator {
  constructor(private readonly dependencies: EventCoordinatorDependencies) {}

  async createFormation(run: QuestRun): Promise<EventCoordinationState> {
    if (!run.proposal || !run.validation?.valid || run.safety?.status !== "approved") {
      throw new Error("Only a validated and safety-approved proposal can enter formation");
    }
    const existing = await this.dependencies.store.findEventCoordinationState(run.runId);
    if (existing) return existing;
    return this.dependencies.store.createEventCoordinationState(this.formationState(run));
  }

  async activateFormation(run: QuestRun, expectedUpdatedAt: string): Promise<QuestRun> {
    if (!run.proposal || !run.validation?.valid || run.safety?.status !== "approved") {
      throw new Error("Only a validated and safety-approved proposal can enter formation");
    }
    return this.dependencies.store.saveQuestRunWithFormation(run, this.formationState(run), expectedUpdatedAt);
  }

  private formationState(run: QuestRun): EventCoordinationState {
    if (!run.proposal || !run.validation) throw new Error("Formation requires a proposal and validation result");
    const now = new Date().toISOString();
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
      invitations: [],
      memberships: [],
      threads: [],
      arrangements: [],
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
      createdAt: now,
      updatedAt: now,
    };
  }

  async getStateForUser(runId: string, userId: string): Promise<EventQuestView> {
    const current = await this.requireState(runId);
    const organizer = current.initiatorId === userId;
    const pendingInvitation = [...current.invitations].reverse().find((invitation) =>
      invitation.guestId === userId && invitation.status === "pending");
    const activeMembership = [...current.memberships].reverse().find((membership) =>
      membership.userId === userId && this.isActiveMembership(membership));
    if (!organizer && !pendingInvitation && !activeMembership) {
      throw new Error("Event coordination state was not found");
    }
    const safe = structuredClone(current) as EventQuestView;
    if (organizer && current.lifecycle === "forming") {
      safe.rosterValidation = this.dependencies.validateRoster
        ? await this.dependencies.validateRoster(current.proposal)
        : this.basicRosterValidation(current.proposal);
    }
    safe.viewer = {
      role: organizer ? "organizer" : pendingInvitation ? "pending_invitee" : "participant",
      canChat: this.canCoordinate(current, userId),
      pendingInvitationId: pendingInvitation?.invitationId ?? null,
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
    safe.threads = safe.threads.filter((thread) => thread.userId === userId);
    safe.notifications = safe.notifications.filter((notification) => notification.userId === userId);
    safe.auditEvents = [];
    safe.outbox = [];
    safe.processedCommands = [];
    if (!organizer) safe.invitations = safe.invitations.filter((invitation) => invitation.guestId === userId);
    safe.proposal.quest.needsAddressed = [];
    safe.proposal.proposedParticipants = safe.proposal.proposedParticipants.map((participant) => ({
      ...participant,
      needsAddressed: [],
      contributionsUsed: [],
    }));
    return safe;
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
        status: "pending",
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
    return this.dependencies.store.saveEventCoordinationState({
      ...current,
      lifecycle: "awaiting_responses",
      revision: current.revision + 1,
      rosterValidation: latestValidation,
      invitations: [...current.invitations, ...invitations],
      memberships,
      threads: [...current.threads, ...threads],
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
    const output = this.dependencies.coordinate
      ? await this.dependencies.coordinate({ state: current, thread, message: input.body })
      : { reply: "Thank you. I have noted this for coordination.", requirementPatch: undefined };
    const updatedThread: EventCoordinationThread = {
      ...thread,
      revision: thread.revision + 1,
      messages: [...thread.messages, participantMessage, {
        messageId: `message_${randomUUID()}`,
        role: "assistant",
        body: output.reply,
        kind: "text",
        createdAt: now,
      }],
      pendingRequirements: output.requirementPatch
        ? { ...(thread.pendingRequirements ?? {}), ...output.requirementPatch }
        : thread.pendingRequirements,
      updatedAt: now,
    };
    const sharedAvailability = input.actorId !== current.initiatorId
      && this.hasAvailabilityUpdate(output.requirementPatch);
    const actorProfile = sharedAvailability
      ? await this.dependencies.resolveMember?.(input.actorId)
      : null;
    const actorName = actorProfile?.displayName ?? this.displayMember(input.actorId);
    const availabilityNotification = sharedAvailability ? {
      notificationId: `notification_${randomUUID()}`,
      userId: current.initiatorId,
      kind: "availability_shared" as const,
      title: `${actorName} shared availability`,
      body: `Availability is waiting for ${actorName} to confirm.`,
      readAt: null,
      deduplicationKey: `availability-shared:${thread.threadId}:${updatedThread.revision}`,
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
      auditEvents: [...current.auditEvents, this.auditEvent(current, "coordination_message_added", input.actorId, null, {
        threadId: thread.threadId,
        messageId: input.clientMessageId,
        availabilityShared: sharedAvailability,
      }, current.lifecycle)],
      updatedAt: now,
    }, current.revision);
    return structuredClone(updatedThread);
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
    let arrangement = structuredClone(target);
    let lifecycle = current.lifecycle;
    let memberships = current.memberships;
    let threads = current.threads;
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
          messages: [...thread.messages, {
            messageId: `message_${randomUUID()}`,
            role: "system" as const,
            body: `${arrangement.venueName}, ${new Date(arrangement.start).toLocaleString()} is ready for confirmation.`,
            kind: "arrangement_card" as const,
            createdAt: now,
          }],
          updatedAt: now,
        }));
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
      if (!membership || membership.role !== "participant") {
        throw new Error("Only an accepted participant can confirm this arrangement");
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
        notifications = [...notifications, {
          notificationId: `notification_${randomUUID()}`,
          userId: current.initiatorId,
          kind: "change",
          title: "Arrangement needs adjustment",
          body: "A participant could not confirm the proposed arrangement.",
          readAt: null,
          deduplicationKey: `arrangement-rejected:${arrangement.arrangementId}:${input.actorId}`,
          createdAt: now,
        }];
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
    }

    return this.dependencies.store.saveEventCoordinationState({
      ...current,
      lifecycle,
      revision: current.revision + 1,
      arrangements: current.arrangements.map((candidate) => candidate.arrangementId === target.arrangementId ? arrangement : candidate),
      memberships,
      threads,
      notifications,
      auditEvents: [...current.auditEvents, this.auditEvent(current, `arrangement_${input.action}`, input.actorId, input.idempotencyKey, {
        arrangementId: target.arrangementId,
        arrangementStatus: arrangement.status,
      }, lifecycle)],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: now,
    }, current.revision);
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
      revision: current.revision + 1,
      rosterRevision: current.rosterRevision + 1,
      roster,
      proposal,
      rosterValidation,
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
      }, current.lifecycle)],
      updatedAt: now,
    }, current.revision);
  }

  /**
   * Add a newly matched person to a future activity without bypassing the
   * invitation flow. Existing members receive a private coordination update;
   * the new person receives a normal invitation and can only join after
   * accepting it.
   */
  async addMatchedParticipant(input: {
    runId: string;
    candidateId: string;
    expectedRevision: number;
  }): Promise<EventCoordinationState> {
    const current = await this.requireState(input.runId);
    if (current.roster.some((member) => member.userId === input.candidateId)) return current;
    if (!["forming", "awaiting_responses", "coordinating", "awaiting_confirmation"].includes(current.lifecycle)) {
      throw new Error("This activity is no longer accepting matched participants");
    }
    if (current.revision !== input.expectedRevision) throw new Error("Quest state conflict; reload and retry");
    if (current.proposal.proposedParticipants.length >= 5) throw new Error("This activity has reached its group limit");
    const resolved = await this.dependencies.resolveParticipant?.(input.candidateId);
    if (!resolved) throw new Error("This person is not currently eligible for this activity");
    if (current.proposal.proposedParticipants.some((participant) => participant.candidateId === input.candidateId)) {
      throw new Error("This person is already in the activity proposal");
    }
    if (current.lifecycle === "forming") {
      return this.updateRoster({
        runId: input.runId,
        actorId: current.initiatorId,
        expectedRevision: input.expectedRevision,
        action: "add",
        userId: input.candidateId,
      });
    }

    const participant = resolved.participant;
    const proposal: QuestProposal = {
      ...structuredClone(current.proposal),
      quest: {
        ...current.proposal.quest,
        groupSize: current.proposal.proposedParticipants.length + 1,
        needsAddressed: [...new Set([
          ...current.proposal.quest.needsAddressed,
          ...participant.needsAddressed,
        ])],
      },
      proposedParticipants: [...current.proposal.proposedParticipants, participant],
      mutualBenefitExplanation: [
        ...current.proposal.mutualBenefitExplanation,
        ...resolved.explanation,
      ],
    };
    const rosterValidation = this.dependencies.validateRoster
      ? await this.dependencies.validateRoster(proposal)
      : this.basicRosterValidation(proposal);
    if (!rosterValidation.valid) {
      throw new Error(rosterValidation.errors.map((error) => error.message).join(" ") || "The matched participant could not be added safely");
    }

    const now = new Date().toISOString();
    const invitation: EventInvitation = {
      invitationId: `invitation_${randomUUID()}`,
      runId: current.runId,
      inviterId: current.initiatorId,
      guestId: input.candidateId,
      status: "pending",
      version: 1,
      deliveryState: "pending",
      idempotencyKey: `matched:${current.runId}:${input.candidateId}:${current.rosterRevision + 1}`,
      rosterRevision: current.rosterRevision + 1,
      createdAt: now,
      updatedAt: now,
    };
    const newRoster: EventRosterMember = {
      userId: input.candidateId,
      source: "recommended",
      proposedRole: participant.proposedRole,
      explanation: resolved.explanation,
    };
    const announcement = "A new compatible participant may join this activity after responding to their invitation.";
    const updatedThreads = current.threads.map((thread) => ({
      ...thread,
      messages: [...thread.messages, {
        messageId: `message_${randomUUID()}`,
        role: "system" as const,
        body: announcement,
        kind: "change_card" as const,
        createdAt: now,
      }],
      updatedAt: now,
    }));
    const thread: EventCoordinationThread = {
      threadId: `coordination_${randomUUID()}`,
      runId: current.runId,
      userId: input.candidateId,
      revision: 1,
      messages: [{
        messageId: `message_${randomUUID()}`,
        role: "system",
        body: `You are invited to ${proposal.quest.title}. The displayed time is availability, not a confirmed schedule.`,
        kind: "invitation_card",
        createdAt: now,
      }],
      confirmedRequirements: this.emptyRequirements(),
      pendingRequirements: null,
      lastReadAt: null,
      updatedAt: now,
    };
    const recipients = [...new Set([
      current.initiatorId,
      ...current.roster.map((member) => member.userId),
      ...current.memberships.filter((membership) => this.isActiveMembership(membership)).map((membership) => membership.userId),
    ])].filter((userId) => userId !== input.candidateId);
    const notifications: EventNotification[] = [
      {
        notificationId: `notification_${randomUUID()}`,
        userId: input.candidateId,
        kind: "invitation",
        title: `Invitation: ${proposal.quest.title}`,
        body: "A compatible group was found. Review the activity and respond when ready.",
        readAt: null,
        deduplicationKey: `invitation:${invitation.invitationId}`,
        createdAt: now,
      },
      ...recipients.map((userId) => ({
        notificationId: `notification_${randomUUID()}`,
        userId,
        kind: "change" as const,
        title: "A new participant may join",
        body: announcement,
        readAt: null,
        deduplicationKey: `matched-participant:${current.runId}:${input.candidateId}:${userId}`,
        createdAt: now,
      })),
    ];
    const outbox: EventOutboxJob[] = [
      {
        jobId: `outbox_${randomUUID()}`,
        kind: "invitation",
        recipientId: input.candidateId,
        deduplicationKey: `invitation:${invitation.invitationId}`,
        payload: { runId: current.runId, invitationId: invitation.invitationId },
        status: "pending",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      },
      ...notifications.map((notification) => ({
        jobId: `outbox_${randomUUID()}`,
        kind: "notification" as const,
        recipientId: notification.userId,
        deduplicationKey: notification.deduplicationKey,
        payload: { runId: current.runId, notificationId: notification.notificationId },
        status: "pending" as const,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      })),
    ];
    const lifecycle = current.lifecycle === "awaiting_confirmation" ? "coordinating" as const : current.lifecycle;
    const arrangements = current.lifecycle === "awaiting_confirmation"
      ? current.arrangements.map((arrangement) => ["proposed", "initiator_approved", "awaiting_participant_confirmation"].includes(arrangement.status)
        ? { ...arrangement, status: "superseded" as const, updatedAt: now }
        : arrangement)
      : current.arrangements;
    const memberships = current.lifecycle === "awaiting_confirmation"
      ? current.memberships.map((membership) => this.isActiveMembership(membership)
        ? { ...membership, status: "coordinating" as const, updatedAt: now }
        : membership)
      : current.memberships;
    const saved = await this.dependencies.store.saveEventCoordinationState({
      ...current,
      lifecycle,
      revision: current.revision + 1,
      rosterRevision: current.rosterRevision + 1,
      proposal,
      rosterValidation,
      roster: [...current.roster, newRoster],
      invitations: [...current.invitations, invitation],
      memberships,
      threads: [...updatedThreads, thread],
      arrangements,
      notifications: [...current.notifications, ...notifications],
      outbox: [...current.outbox, ...outbox],
      auditEvents: [...current.auditEvents, this.auditEvent(current, "matched_participant_added", current.initiatorId, invitation.idempotencyKey, {
        userId: input.candidateId,
        rosterRevision: current.rosterRevision + 1,
      }, lifecycle)],
      processedCommands: [...current.processedCommands, invitation.idempotencyKey],
      updatedAt: now,
    }, current.revision);
    await this.dependencies.store.syncQuestProposal?.(saved.runId, saved.proposal);
    return saved;
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
    const memberships = input.response === "accept"
      ? [...current.memberships, {
          membershipId: `membership_${randomUUID()}`,
          runId: current.runId,
          userId: input.actorId,
          role: "participant" as const,
          rosterSource: rosterMember.source,
          status: "coordinating" as const,
          joinedAt: now,
          updatedAt: now,
        }]
      : current.memberships;
    const pending = invitations.some((candidate) => candidate.status === "pending");
    const lifecycle = pending
      ? current.lifecycle
      : memberships.length >= 2 ? "coordinating" as const : "forming" as const;
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
      notifications: [...current.notifications, ...notifications],
      outbox: input.action === "cancel"
        ? [...current.outbox.map((job) => job.status === "pending" ? { ...job, status: "cancelled" as const, updatedAt: now } : job), ...cancellationJobs]
        : current.outbox,
      auditEvents: [...current.auditEvents, this.auditEvent(current, `quest_${input.action}`, input.actorId, input.idempotencyKey, {}, lifecycle)],
      processedCommands: [...current.processedCommands, input.idempotencyKey],
      updatedAt: now,
    }, current.revision);
  }

  async markNotificationsRead(input: { actorId: string; runId?: string }): Promise<number> {
    const states = await this.dependencies.store.listEventCoordinationStates(input.actorId);
    let marked = 0;
    for (const current of states.filter((state) => !input.runId || state.runId === input.runId)) {
      const unread = current.notifications.filter((notification) =>
        notification.userId === input.actorId && notification.readAt === null).length;
      if (!unread) continue;
      const now = new Date().toISOString();
      await this.dependencies.store.saveEventCoordinationState({
        ...current,
        revision: current.revision + 1,
        notifications: current.notifications.map((notification) =>
          notification.userId === input.actorId && notification.readAt === null
            ? { ...notification, readAt: now }
            : notification),
        auditEvents: [...current.auditEvents, this.auditEvent(current, "notifications_read", input.actorId, null, { count: unread }, current.lifecycle)],
        updatedAt: now,
      }, current.revision);
      marked += unread;
    }
    return marked;
  }

  async listNotifications(userId: string, limit = 50): Promise<EventNotificationView[]> {
    const states = await this.dependencies.store.listEventCoordinationStates(userId);
    return states
      .flatMap((state) => state.notifications
        .filter((notification) => notification.userId === userId)
        .map((notification) => ({
          ...notification,
          runId: state.runId,
          questTitle: state.proposal.quest.title,
        })))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.min(50, Math.max(1, limit)));
  }

  async listActivities(userId: string): Promise<UserEventActivities> {
    const [states, questRuns] = await Promise.all([
      this.dependencies.store.listEventCoordinationStates(userId),
      this.dependencies.store.listQuestRuns(userId, 50),
    ]);
    const result: UserEventActivities = {
      unreadCount: 0,
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
    for (const state of states) {
      const userNotifications = state.notifications.filter((notification) => notification.userId === userId);
      result.unreadCount += userNotifications.filter((notification) => notification.readAt === null).length;
      result.notifications.push(...userNotifications.map((notification) => ({
        ...notification,
        runId: state.runId,
        questTitle: state.proposal.quest.title,
      })));
      const activity = this.activityCard(state);
      if (state.lifecycle === "forming"
        && state.memberships.length === 0
        && (state.initiatorId === userId || state.roster.some((member) => member.userId === userId))) {
        result.suggested.push(activity);
      }
      for (const invitation of state.invitations) {
        const view = { ...invitation, activity };
        if (invitation.guestId === userId && invitation.status === "pending") result.invitations.push(view);
        if (state.initiatorId === userId) result.sentInvitations.push(view);
      }
      const membership = [...state.memberships].reverse().find((candidate) =>
        candidate.userId === userId && (this.isActiveMembership(candidate) || state.lifecycle === "cancelled"));
      if (!membership) continue;
      if (membership.status === "cancelled" || state.lifecycle === "cancelled") result.my.cancelled.push(activity);
      else if (membership.status === "completed" || state.lifecycle === "completed") result.my.completed.push(activity);
      else if (membership.status === "confirmed" && ["scheduled", "in_progress"].includes(state.lifecycle)) {
        result.my.upcoming.push(activity);
      } else if (membership.status === "awaiting_confirmation" || state.lifecycle === "awaiting_confirmation") {
        result.my.awaitingConfirmation.push(activity);
      } else result.my.awaitingCoordination.push(activity);
    }
    const representedRunIds = new Set(states.map((state) => state.runId));
    for (const run of questRuns) {
      if (representedRunIds.has(run.runId) || !run.proposal) continue;
      if (!["human_review", "awaiting_acceptance", "confirmed"].includes(run.status)) continue;
      if (Date.parse(run.proposal.quest.proposedTimeWindow.end) <= Date.now()) continue;
      const activity = this.questRunActivityCard(run);
      const accepted = run.coordination?.invitations.some((invitation) =>
        invitation.candidateId === userId && invitation.status === "accepted");
      if (accepted) result.my.awaitingCoordination.push(activity);
      else if (run.initiatingCandidateId === userId
        || run.proposal.proposedParticipants.some((participant) => participant.candidateId === userId)) {
        result.suggested.push(activity);
      }
    }
    result.notifications.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    return result;
  }

  private questRunActivityCard(run: QuestRun): EventActivityCard {
    if (!run.proposal) throw new Error("Quest run proposal is required for an activity card");
    return {
      runId: run.runId,
      title: run.proposal.quest.title,
      description: run.proposal.quest.description,
      lifecycle: run.status === "human_review" ? "human_review" : "awaiting_responses",
      durationMinutes: run.proposal.quest.durationMinutes,
      provisionalAvailability: run.proposal.quest.proposedTimeWindow ?? null,
      finalArrangement: null,
    };
  }

  private activityCard(state: EventCoordinationState): EventActivityCard {
    const finalized = [...state.arrangements].reverse().find((arrangement) => arrangement.status === "finalized");
    return {
      runId: state.runId,
      title: state.proposal.quest.title,
      description: state.proposal.quest.description,
      lifecycle: state.lifecycle,
      durationMinutes: state.proposal.quest.durationMinutes,
      provisionalAvailability: state.proposal.quest.proposedTimeWindow ?? null,
      finalArrangement: finalized ? {
        start: finalized.start,
        end: finalized.end,
        venueName: finalized.venueName,
        version: finalized.version,
      } : null,
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

  private isActiveMembership(membership: EventMembership): boolean {
    return !["withdrawn", "replaced", "cancelled", "completed"].includes(membership.status);
  }

  private canCoordinate(state: EventCoordinationState, userId: string): boolean {
    if (state.initiatorId === userId) return true;
    return state.memberships.some((membership) => membership.userId === userId && this.isActiveMembership(membership));
  }

  private canViewCoordination(state: EventCoordinationState, userId: string): boolean {
    if (this.canCoordinate(state, userId)) return true;
    return state.invitations.some((invitation) => invitation.guestId === userId && invitation.status === "pending");
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
    return userId
      .replace(/^demo_/, "")
      .replaceAll("_", " ")
      .replace(/^./, (letter) => letter.toUpperCase());
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
    return state;
  }
}
