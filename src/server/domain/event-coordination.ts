import type { QuestProposal, ValidationResult } from "@/server/domain/schemas";
import { z } from "zod";

export type EventQuestLifecycle =
  | "forming"
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

export type RosterSource = "initiator" | "recommended" | "manual";

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

export interface EventCoordinationMessage {
  messageId: string;
  role: "participant" | "assistant" | "system";
  body: string;
  kind: "text" | "invitation_card" | "arrangement_card" | "change_card";
  createdAt: string;
}

export interface EventCoordinationThread {
  threadId: string;
  runId: string;
  userId: string;
  revision: number;
  messages: EventCoordinationMessage[];
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

export interface EventCoordinationState {
  runId: string;
  initiatorId: string;
  lifecycle: EventQuestLifecycle;
  revision: number;
  rosterRevision: number;
  proposal: QuestProposal;
  rosterValidation: ValidationResult;
  roster: EventRosterMember[];
  invitations: EventInvitation[];
  memberships: EventMembership[];
  threads: EventCoordinationThread[];
  arrangements: EventArrangement[];
  notifications: EventNotification[];
  auditEvents: EventCoordinationAuditEvent[];
  outbox: EventOutboxJob[];
  processedCommands: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EventQuestView extends EventCoordinationState {
  viewer: {
    role: "organizer" | "pending_invitee" | "participant";
    canChat: boolean;
    pendingInvitationId: string | null;
  };
  participantProgress: EventParticipantProgress[];
}

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
  provisionalAvailability: { start: string; end: string } | null;
  finalArrangement: {
    start: string;
    end: string;
    venueName: string;
    version: number;
  } | null;
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
