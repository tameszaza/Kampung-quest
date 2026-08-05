import { availabilityWindowSchema, type Participant, type QuestProposal, type ValidationResult } from "@/server/domain/schemas";
import type { EventRewardEntry, EventTaskPlan } from "@/server/domain/event-tasks";
import { z } from "zod";

export type EventQuestLifecycle =
  | "forming"
  | "recruiting"
  | "awaiting_responses"
  | "coordinating"
  | "awaiting_confirmation"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "human_review";

export interface AvailabilityHorizon {
  start: string;
  end: string;
}

export type RosterSource = "initiator" | "recommended" | "manual" | "application";

export interface EventRosterMember {
  userId: string;
  source: RosterSource;
  proposedRole: string;
  explanation: string[];
}

export type EventInvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "withdrawn"
  | "replaced"
  | "cancelled";

export interface EventInvitation {
  invitationId: string;
  runId: string;
  inviterId: string;
  guestId: string;
  status: EventInvitationStatus;
  version: number;
  deliveryState: "pending" | "delivered" | "failed" | "cancelled";
  idempotencyKey: string;
  rosterRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventCoordinationAuditEvent {
  eventId: string;
  type: string;
  actorId: string | null;
  aggregateRevision: number;
  previousLifecycle: EventQuestLifecycle;
  newLifecycle: EventQuestLifecycle;
  idempotencyKey: string | null;
  safeDiff: Record<string, unknown>;
  createdAt: string;
}

export interface EventOutboxJob {
  jobId: string;
  kind: "invitation" | "notification";
  recipientId: string;
  deduplicationKey: string;
  payload: Record<string, unknown>;
  status: "pending" | "delivered" | "failed" | "cancelled";
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export type EventMembershipStatus =
  | "coordinating"
  | "awaiting_confirmation"
  | "confirmed"
  | "completed"
  | "withdrawn"
  | "replaced"
  | "cancelled";

export interface EventMembership {
  membershipId: string;
  runId: string;
  userId: string;
  role: "organizer" | "participant";
  rosterSource: RosterSource;
  status: EventMembershipStatus;
  joinedAt: string;
  updatedAt: string;
}

export interface EventNotification {
  notificationId: string;
  userId: string;
  kind:
    | "invitation"
    | "invitation_response"
    | "arrangement"
    | "change"
    | "cancellation"
    | "availability_shared"
    | "availability_confirmed";
  title: string;
  body: string;
  readAt: string | null;
  deduplicationKey: string;
  createdAt: string;
}

export interface EventNotificationView extends EventNotification {
  runId: string;
}

export interface CoordinationRequirements {
  availableWindows: Array<{ start: string; end: string }>;
  accessibility: string[];
  travel: string[];
  dietary: string[];
  environmental: string[];
  venuePreferences: string[];
  temporaryConflicts: string[];
  other: string[];
}

const coordinationRequirementPatchSchema = z.object({
  availableWindows: z.array(availabilityWindowSchema).optional(),
  accessibility: z.array(z.string().min(1)).optional(),
  travel: z.array(z.string().min(1)).optional(),
  dietary: z.array(z.string().min(1)).optional(),
  environmental: z.array(z.string().min(1)).optional(),
  venuePreferences: z.array(z.string().min(1)).optional(),
  temporaryConflicts: z.array(z.string().min(1)).optional(),
  other: z.array(z.string().min(1)).optional(),
});

export const appointmentPatchSchema = z.object({
  start: z.iso.datetime({ offset: true }).optional(),
  end: z.iso.datetime({ offset: true }).optional(),
  /** Local wall-clock time in HH:mm, resolved on the current appointment date. */
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  durationMinutes: z.number().int().min(15).max(120).optional(),
  venueName: z.string().min(1).optional(),
  venueAddress: z.string().nullable().optional(),
});

export type AppointmentPatch = z.infer<typeof appointmentPatchSchema>;

export const coordinationIntentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("social") }),
  z.object({ type: z.literal("question"), topic: z.enum(["status", "confirmations", "compatibility", "other"]) }),
  z.object({
    type: z.literal("update_requirement"),
    patch: coordinationRequirementPatchSchema,
    ambiguity: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("change_appointment"),
    patch: appointmentPatchSchema,
    referencesSuggestionId: z.string().optional(),
  }),
  z.object({ type: z.literal("confirm_appointment"), appointmentVersion: z.number().int().positive().nullable() }),
  z.object({ type: z.literal("reject_appointment"), appointmentVersion: z.number().int().positive().nullable(), reason: z.string().optional() }),
  z.object({
    type: z.literal("organizer_action"),
    action: z.enum(["change_roster", "cancel", "start", "complete"]),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ type: z.literal("unsupported"), reason: z.string().min(1) }),
]);

export type CoordinationIntent = z.infer<typeof coordinationIntentSchema>;

export interface EventCoordinationMessage {
  messageId: string;
  senderId?: string | null;
  role: "participant" | "assistant" | "system";
  body: string;
  kind: "text" | "invitation_card" | "arrangement_card" | "change_card";
  createdAt: string;
  /** Receipt state for participant messages when the transport can provide it. */
  receipt?: "delivered" | "read";
}

export interface EventGroupCoordinationThread {
  threadId: string;
  runId: string;
  revision: number;
  messages: EventCoordinationMessage[];
  visibleAppointmentVersion: number | null;
  readBy: Record<string, string>;
  updatedAt: string;
}

export interface EventCoordinationThread {
  threadId: string;
  runId: string;
  userId: string;
  revision: number;
  messages: EventCoordinationMessage[];
  visibleAppointmentVersion: number | null;
  confirmedRequirements: CoordinationRequirements;
  pendingRequirements: Partial<CoordinationRequirements> | null;
  lastReadAt: string | null;
  updatedAt: string;
}

export type ArrangementStatus =
  | "proposed"
  | "initiator_approved"
  | "awaiting_participant_confirmation"
  | "finalized"
  | "superseded"
  | "rejected";

export interface EventArrangement {
  arrangementId: string;
  version: number;
  start: string;
  end: string;
  venueName: string;
  venueAddress: string | null;
  venueStatus: "proposed" | "participant_confirmed" | "externally_confirmed";
  status: ArrangementStatus;
  materialChanges: string[];
  confirmations: Array<{
    userId: string;
    status: "pending" | "confirmed" | "rejected";
    respondedAt: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface EventAppointmentSuggestion {
  suggestionId: string;
  runId: string;
  basedOnRevision: number;
  sourceMessageId: string;
  requestedPatch: AppointmentPatch;
  alternative: {
    start: string;
    end: string;
    venueName: string;
    venueAddress: string | null;
  };
  publicReasonCategories: string[];
  status: "offered" | "accepted" | "expired";
  expiresAt: string;
  createdAt: string;
}

export interface EventCoordinationState {
  runId: string;
  initiatorId: string;
  lifecycle: EventQuestLifecycle;
  revision: number;
  rosterRevision: number;
  proposal: QuestProposal;
  rosterValidation: ValidationResult;
  roster: EventRosterMember[];
  recruitment: EventRecruitment;
  joinRequests: EventJoinRequest[];
  invitations: EventInvitation[];
  memberships: EventMembership[];
  threads: EventCoordinationThread[];
  groupThread: EventGroupCoordinationThread | null;
  arrangements: EventArrangement[];
  taskPlans: EventTaskPlan[];
  rewardEntries: EventRewardEntry[];
  appointmentSuggestions: EventAppointmentSuggestion[];
  notifications: EventNotification[];
  auditEvents: EventCoordinationAuditEvent[];
  outbox: EventOutboxJob[];
  processedCommands: string[];
  /** IANA timezone used to resolve conversational dates and wall-clock times. */
  timeZone: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventQuestView extends EventCoordinationState {
  viewer: {
    role: "organizer" | "pending_invitee" | "participant" | "selected" | "applicant";
    canChat: boolean;
    pendingInvitationId: string | null;
    recruitmentEligibility: EventRecruitmentViewerEligibility | null;
  };
  participantProgress: EventParticipantProgress[];
  recruitmentProgress: {
    currentApprovedCount: number;
  };
  applicantProfiles: Array<{
    userId: string;
    displayName: string;
    photoUrl: string | null;
  }>;
}

export interface EventRecruitment {
  status: "draft" | "open" | "closed";
  minimumGroupSize: number;
  targetGroupSize: number;
  maximumGroupSize: number;
  publishedAt: string | null;
}

export interface EventJoinRequest {
  requestId: string;
  runId: string;
  applicantId: string;
  status: "pending" | "approved" | "rejected";
  version: number;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventRecruitmentCandidate {
  participant: Participant;
  explanation: string[];
  score?: number;
  eligibilityGuard?: EventRecruitmentEligibilityGuard;
}

export interface EventRecruitmentEligibilityGuard {
  candidateId: string;
  profileVersions: Array<{ candidateId: string; memoryVersion: number }>;
  start: string;
  end: string;
  excludeRunId: string;
}

export interface EventRecruitmentViewerEligibility {
  canRequest: boolean;
  notices: string[];
}

export type EventRecruitmentAssessment =
  | { eligible: true; candidate: EventRecruitmentCandidate }
  | { eligible: false; discoverable: boolean; reason: string; notices: string[] };

export interface EventParticipantProgress {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  invitationStatus: EventInvitationStatus | "organizer";
  membershipStatus: EventMembershipStatus | null;
  availabilityStatus: "not_shared" | "awaiting_confirmation" | "confirmed";
  updatedAt: string | null;
}

export const rosterUpdateRequestSchema = z.object({
  action: z.enum(["add", "remove"]),
  userId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
});

export const rosterConfirmRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
});

export const recruitmentPublishRequestSchema = z.object({
  targetGroupSize: z.number().int().min(2).max(5),
  expectedRevision: z.number().int().positive(),
});

export const joinRequestCreateSchema = z.object({
  expectedRevision: z.number().int().positive(),
});

export const joinRequestDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  expectedRevision: z.number().int().positive(),
});

export const invitationResponseRequestSchema = z.object({
  runId: z.string().min(1),
  response: z.enum(["accept", "decline"]),
  expectedRevision: z.number().int().positive(),
});

export const invitationTransitionRequestSchema = z.object({
  runId: z.string().min(1),
  action: z.enum(["expire", "withdraw", "replace", "cancel"]),
  expectedRevision: z.number().int().positive(),
});

export const questLifecycleRequestSchema = z.object({
  action: z.enum(["cancel", "start", "complete", "reopen"]),
  expectedRevision: z.number().int().positive(),
});

export const coordinationMessageRequestSchema = z.object({
  body: z.string().trim().min(1).max(2_000),
  clientMessageId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
});

export const arrangementProposalRequestSchema = z.object({
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  venueName: z.string().trim().min(2).max(160),
  venueAddress: z.string().trim().max(240).nullable().default(null),
  expectedRevision: z.number().int().positive(),
}).refine((value) => Date.parse(value.end) > Date.parse(value.start), {
  message: "Arrangement end must be after start",
  path: ["end"],
});

export const arrangementDecisionRequestSchema = z.object({
  action: z.enum(["approve", "reject", "confirm"]),
  expectedRevision: z.number().int().positive(),
});

export interface EventActivityCard {
  runId: string;
  title: string;
  description: string;
  lifecycle: EventQuestLifecycle;
  durationMinutes: number;
  timeZone: string;
  provisionalAvailability: { start: string; end: string } | null;
  workingArrangement: {
    start: string;
    end: string;
    venueName: string;
    version: number;
  } | null;
  finalArrangement: {
    start: string;
    end: string;
    venueName: string;
    version: number;
  } | null;
  recruitment: (EventRecruitment & {
    currentApprovedCount: number;
    viewerRequestStatus: EventJoinRequest["status"] | null;
    viewerEligibility: EventRecruitmentViewerEligibility | null;
  }) | null;
}

export interface EventInvitationView extends EventInvitation {
  activity: EventActivityCard;
}

export interface UserEventActivities {
  unreadCount: number;
  notifications: EventNotificationView[];
  suggested: EventActivityCard[];
  invitations: EventInvitationView[];
  sentInvitations: EventInvitationView[];
  my: {
    awaitingCoordination: EventActivityCard[];
    awaitingConfirmation: EventActivityCard[];
    upcoming: EventActivityCard[];
    completed: EventActivityCard[];
    cancelled: EventActivityCard[];
  };
}
