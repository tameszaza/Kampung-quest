import { z } from "zod";

export const availabilityWindowSchema = z
  .object({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    timeZone: z.string().min(1).optional(),
  })
  .refine((window) => Date.parse(window.end) > Date.parse(window.start), {
    message: "Availability end must be after start",
    path: ["end"],
  });

export const weeklyAvailabilityRuleSchema = z.object({
  kind: z.literal("weekly_recurrence"),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1),
  startLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z.string().min(1),
  validFrom: z.string().date(),
  validUntil: z.string().date(),
}).refine((rule) => Date.parse(rule.validUntil) >= Date.parse(rule.validFrom), {
  message: "Recurring availability end must not precede its start",
  path: ["validUntil"],
});

export const constraintsSchema = z
  .object({
    availableWindows: z.array(availabilityWindowSchema).min(1),
    recurringAvailabilityRules: z.array(weeklyAvailabilityRuleSchema).optional(),
    maximumDistanceM: z.number().int().positive().default(1000),
    minimumGroupSize: z.number().int().min(2).default(2),
    maximumGroupSize: z.number().int().min(2).max(5).default(5),
    indoorRequired: z.boolean().default(false),
    stairsAllowed: z.boolean().default(true),
    dietaryRequirements: z.array(z.string()).default([]),
    languages: z.array(z.string()).min(1).default(["English"]),
    verified: z.boolean().default(true),
    invitationConsent: z.boolean().default(true),
  })
  .refine((value) => value.minimumGroupSize <= value.maximumGroupSize, {
    message: "Minimum group size cannot exceed maximum group size",
    path: ["minimumGroupSize"],
  });

export const candidateProfileSchema = z.object({
  candidateId: z.string().min(1),
  source: z.enum(["real", "demo", "test"]).default("real"),
  need: z.string().min(3),
  interests: z.array(z.string()).default([]),
  offers: z.array(z.string()).default([]),
  constraints: constraintsSchema,
  memoryStatus: z.enum(["active", "fulfilled", "expired"]).default("active"),
  alreadyCommitted: z.boolean().default(false),
  relationshipBlocked: z.boolean().default(false),
  distanceFromInitiatorM: z.number().int().nonnegative().nullable().default(null),
  previousGroupScore: z.number().min(0).max(1).default(0.5),
});

export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>;
export type WeeklyAvailabilityRule = z.infer<typeof weeklyAvailabilityRuleSchema>;
export type CandidateProfile = z.infer<typeof candidateProfileSchema>;

export const assistantRecommendationRequestSchema = z.object({
  conversationId: z.string().min(1),
  requestKey: z.string().min(1).optional(),
  candidateId: z.string().min(1),
  narrative: z.string().min(3),
  interests: z.array(z.string().min(1)).default([]),
  offers: z.array(z.string().min(1)).default([]),
  constraints: constraintsSchema,
});

export type AssistantRecommendationCommand = z.infer<typeof assistantRecommendationRequestSchema>;

export const assistantBriefFieldSchema = z.enum([
  "goal",
  "interests",
  "offers",
  "availability",
  "group_size",
  "indoor",
  "stairs",
  "distance",
  "language",
  "consent",
]);

export type AssistantBriefField = z.infer<typeof assistantBriefFieldSchema>;

export const questBriefDraftSchema = z.object({
  currentGoal: z.string().min(3).optional(),
  interests: z.array(z.string().min(1)).optional(),
  offers: z.array(z.string().min(1)).optional(),
  availableWindows: z.array(availabilityWindowSchema).min(1).optional(),
  recurringAvailabilityRules: z.array(weeklyAvailabilityRuleSchema).optional(),
  minimumGroupSize: z.number().int().min(2).optional(),
  maximumGroupSize: z.number().int().min(2).max(5).optional(),
  indoorRequired: z.boolean().optional(),
  stairsAllowed: z.boolean().optional(),
  maximumDistanceM: z.number().int().positive().optional(),
  language: z.string().min(1).optional(),
  invitationConsent: z.boolean().optional(),
});

export type QuestBriefDraft = z.infer<typeof questBriefDraftSchema>;

export const confirmedQuestBriefSchema = questBriefDraftSchema.required({
  currentGoal: true,
  availableWindows: true,
  minimumGroupSize: true,
  maximumGroupSize: true,
  indoorRequired: true,
  stairsAllowed: true,
  maximumDistanceM: true,
  language: true,
  invitationConsent: true,
}).extend({
  interests: z.array(z.string().min(1)).default([]),
  offers: z.array(z.string().min(1)).default([]),
  recurringAvailabilityRules: z.array(weeklyAvailabilityRuleSchema).default([]),
}).refine((brief) => brief.minimumGroupSize <= brief.maximumGroupSize, {
  message: "Minimum group size cannot exceed maximum group size",
  path: ["minimumGroupSize"],
});

export type ConfirmedQuestBrief = z.infer<typeof confirmedQuestBriefSchema>;

export const assistantTurnAgentOutputSchema = z.object({
  reply: z.string().min(1),
  briefPatch: questBriefDraftSchema,
  requestedField: assistantBriefFieldSchema.nullable(),
  suggestedReplies: z.array(z.string().min(1)).max(4),
  status: z.enum(["collecting", "ready_for_review"]),
});

export type AssistantTurnAgentOutput = z.infer<typeof assistantTurnAgentOutputSchema>;

/*
 * Hosted models occasionally return human-formatted values in optional
 * briefPatch fields. The conversation service already applies the user's
 * structured answer as the authority, so the hosted boundary must not let a
 * malformed model echo invalidate an otherwise valid turn. Only soft facts
 * and an optionally normalizable recurring rule are accepted here; the
 * strict domain schema is still used before anything is persisted.
 */
const hostedWeeklyAvailabilityRuleSchema = z.object({
  daysOfWeek: z.array(z.union([z.number(), z.string()])).min(1),
  kind: z.string().min(1),
  startLocalTime: z.string().min(1),
  endLocalTime: z.string().min(1),
  timeZone: z.string().min(1),
  validFrom: z.string().min(1),
  validUntil: z.string().min(1),
});

const hostedQuestBriefDraftSchema = z.object({
  currentGoal: z.string().min(1).optional(),
  interests: z.array(z.string().min(1)).optional(),
  offers: z.array(z.string().min(1)).optional(),
  recurringAvailabilityRules: z.array(hostedWeeklyAvailabilityRuleSchema).optional(),
});

export const hostedAssistantTurnAgentOutputSchema = z.object({
  reply: z.string().min(1),
  briefPatch: hostedQuestBriefDraftSchema,
  requestedField: assistantBriefFieldSchema.nullable(),
  suggestedReplies: z.array(z.string().min(1)).max(4),
  status: z.enum(["collecting", "ready_for_review"]),
});

export function normalizeWeeklyAvailabilityRuleKind(kind: string): "weekly_recurrence" {
  const normalized = kind.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ([
    "weekly_recurrence",
    "weekly_recurrence_rule",
    "weeklyrecurrence",
    "weekly",
    "weekly_pattern",
    "weekly_availability",
    "weeklyavailability",
    "recurring",
    "recurring_availability",
  ].includes(normalized)) return "weekly_recurrence";
  throw new Error(`Unsupported recurring availability rule kind: ${kind}`);
}

export function normalizeHostedLocalTime(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) return normalized;

  const twelveHour = normalized.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m\.?$/i);
  if (twelveHour) {
    const hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2] ?? "0");
    if (hour >= 1 && hour <= 12 && minute <= 59) {
      const hour24 = twelveHour[3].toLowerCase() === "p"
        ? (hour === 12 ? 12 : hour + 12)
        : (hour === 12 ? 0 : hour);
      return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  const twentyFourHour = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHour) {
    const hour = Number(twentyFourHour[1]);
    const minute = Number(twentyFourHour[2]);
    if (hour <= 23 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  throw new Error(`Unsupported local time format: ${value}`);
}

export function normalizeHostedAssistantTurnOutput(
  output: z.infer<typeof hostedAssistantTurnAgentOutputSchema>,
): AssistantTurnAgentOutput {
  const recurringAvailabilityRules = output.briefPatch.recurringAvailabilityRules?.flatMap((rule) => {
    try {
      const normalizedRule = {
        ...rule,
        kind: normalizeWeeklyAvailabilityRuleKind(rule.kind),
        daysOfWeek: rule.daysOfWeek.map(Number),
        startLocalTime: normalizeHostedLocalTime(rule.startLocalTime),
        endLocalTime: normalizeHostedLocalTime(rule.endLocalTime),
      };
      return [weeklyAvailabilityRuleSchema.parse(normalizedRule)];
    } catch {
      // Recurring rules are never authoritative: the answer payload owns
      // availability. Drop a malformed model rule instead of failing the
      // whole assistant turn.
      return [];
    }
  });

  const currentGoal = output.briefPatch.currentGoal?.trim();
  const interests = output.briefPatch.interests?.map((value) => value.trim()).filter(Boolean);
  const offers = output.briefPatch.offers?.map((value) => value.trim()).filter(Boolean);

  return assistantTurnAgentOutputSchema.parse({
    ...output,
    briefPatch: {
      ...(currentGoal && currentGoal.length >= 3 ? { currentGoal } : {}),
      ...(interests?.length ? { interests } : {}),
      ...(offers?.length ? { offers } : {}),
      ...(recurringAvailabilityRules?.length ? { recurringAvailabilityRules } : {}),
    },
  });
}

export const assistantAnswerSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("goal"), value: z.string().min(3) }),
  z.object({ field: z.literal("interests"), value: z.string().min(1).nullable() }),
  z.object({ field: z.literal("offers"), value: z.string().min(1).nullable() }),
  z.object({ field: z.literal("availability"), value: z.union([
    availabilityWindowSchema,
    z.object({
      availableWindows: z.array(availabilityWindowSchema).min(1),
      recurringAvailabilityRules: z.array(weeklyAvailabilityRuleSchema).default([]),
    }),
  ]) }),
  z.object({ field: z.literal("group_size"), value: z.object({
    minimum: z.number().int().min(2),
    maximum: z.number().int().min(2).max(5),
  }).refine((group) => group.minimum <= group.maximum) }),
  z.object({ field: z.literal("indoor"), value: z.boolean() }),
  z.object({ field: z.literal("stairs"), value: z.boolean() }),
  z.object({ field: z.literal("distance"), value: z.number().int().positive() }),
  z.object({ field: z.literal("language"), value: z.string().min(1) }),
  z.object({ field: z.literal("consent"), value: z.boolean() }),
]);

export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>;

export const assistantConversationCreateRequestSchema = z.object({
  candidateId: z.string().min(1),
});

export const assistantTurnRequestSchema = z.object({
  clientTurnId: z.string().min(1),
  revision: z.number().int().positive(),
  answer: assistantAnswerSchema,
});

export const assistantConfirmRequestSchema = z.object({
  revision: z.number().int().positive(),
});

export interface AssistantConversationMessage {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export type AssistantConversationStatus =
  | "collecting"
  | "ready_for_review"
  | "confirmed"
  | "processing"
  | "complete"
  | "no_match"
  | "failed";

export interface AssistantWorkflowEvent {
  sequence: number;
  stage: "brief" | "memory" | "retrieval" | "synthesis" | "validation" | "safety";
  status: "started" | "completed" | "failed";
  message: string;
  kind: "agent" | "system";
  createdAt: string;
}

export interface AssistantConversationSnapshot {
  conversationId: string;
  candidateId: string;
  status: AssistantConversationStatus;
  revision: number;
  messages: AssistantConversationMessage[];
  brief: QuestBriefDraft;
  nextField: AssistantBriefField | null;
  suggestedReplies: string[];
  questRunId: string | null;
  events: AssistantWorkflowEvent[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryCard {
  profile: CandidateProfile;
  markdown: string;
  updatedAt: string;
  version: number;
  retrievalReady: boolean;
  narrative: string;
}

export interface MemoryUpdateCommand {
  profile: CandidateProfile;
  narrative: string;
  providedSoftFacts?: {
    need: boolean;
    interests: boolean;
    offers: boolean;
  };
  auditContext?: Record<string, string>;
}

export interface MemoryAgentOutput {
  markdown: string;
  need: string;
  interests: string[];
  offers: string[];
}

export type EmbeddingKind = "need" | "interest" | "offer";

export interface CandidateEmbedding {
  candidateId: string;
  memoryVersion: number;
  kind: EmbeddingKind;
  model: string;
  dimensions: number;
  vector: number[];
}

export interface RetrievalCommand {
  initiatingCandidateId: string;
  limit?: number;
}

export interface RetrievalScores {
  needSimilarity: number;
  offerComplementarity: number;
  interestSimilarity: number;
  socialCompatibility: number;
  previousInteraction: number;
  total: number;
}

export interface RetrievedCandidate {
  profile: CandidateProfile;
  scores: RetrievalScores;
}

export interface Participant {
  candidateId: string;
  proposedRole: string;
  needsAddressed: string[];
  contributionsUsed: string[];
}

export interface QuestProposal {
  quest: {
    title: string;
    questType: string;
    sharedGoal: string;
    description: string;
    needsAddressed: string[];
    durationMinutes: number;
    groupSize: number;
    venueRequirements: string[];
    proposedTimeWindow: AvailabilityWindow;
  };
  proposedParticipants: Participant[];
  reserveCandidates: Array<{
    candidateId: string;
    possibleRole: string;
    reason: string;
  }>;
  mutualBenefitExplanation: string[];
  confidence: number;
}

export interface ValidationErrorItem {
  candidateId?: string;
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrorItem[];
}

export interface SafetyReview {
  status: "approved" | "rejected" | "human_review";
  riskLevel: "low" | "medium" | "high";
  conditions: string[];
  requiresHumanReview: boolean;
}

export interface CoordinationPlan {
  questId: string;
  state: "awaiting_acceptance" | "confirmed" | "human_review" | "completed" | "cancelled";
  invitations: Array<{
    candidateId: string;
    status: "pending" | "accepted" | "declined" | "replaced";
  }>;
  nextAction: string;
}

export type CoordinationEventType =
  | "participant_added"
  | "participant_accepted"
  | "participant_declined"
  | "participant_timed_out"
  | "quest_completed"
  | "quest_cancelled";

export interface CoordinationEventCommand {
  runId: string;
  type: CoordinationEventType;
  candidateId?: string;
  occurredAt?: string;
}

export interface CoordinationEventRecord extends CoordinationEventCommand {
  eventId: string;
  occurredAt: string;
}

export type QuestStatus =
  | "processing"
  | "no_match"
  | "forming"
  | "awaiting_acceptance"
  | "confirmed"
  | "human_review"
  | "completed"
  | "cancelled"
  | "failed";

export interface ProposeQuestCommand {
  initiatingCandidateId: string;
  candidateLimit?: number;
  idempotencyKey?: string;
  conversationId?: string;
}

export interface QuestRun {
  runId: string;
  initiatingCandidateId: string;
  idempotencyKey: string | null;
  /** Request keys used when additional participants were added to this run. */
  participantIdempotencyKeys?: string[];
  status: QuestStatus;
  proposal: QuestProposal | null;
  validation: ValidationResult | null;
  safety: SafetyReview | null;
  coordination: CoordinationPlan | null;
  /** Public identity snapshots for participants visible to the current viewer. */
  participantProfiles?: QuestParticipantProfile[];
  /** Optimized, generated thumbnail. The UI uses a neutral placeholder while it is pending. */
  imageUrl?: string | null;
  noMatch?: {
    reason: string;
    missingCapabilities: string[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuestParticipantProfile {
  candidateId: string;
  displayName: string;
  photoUrl: string | null;
  proposedRole: string;
}

export interface AgentRunAudit {
  runId: string;
  role: string;
  model: string;
  promptVersion: string;
  outcome: "succeeded" | "failed";
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  metadata: Record<string, string>;
}

export interface PipelineResult {
  proposal: QuestProposal;
  validation: ValidationResult;
  safety: SafetyReview | null;
  coordination: CoordinationPlan | null;
}

export const memoryAgentOutputSchema = z.object({
  markdown: z.string().min(1),
  need: z.string().min(3),
  interests: z.array(z.string()),
  offers: z.array(z.string()),
}) satisfies z.ZodType<MemoryAgentOutput>;

export const questProposalSchema = z.object({
  quest: z.object({
    title: z.string().min(1),
    questType: z.string().min(1),
    sharedGoal: z.string().min(1),
    description: z.string().min(1),
    needsAddressed: z.array(z.string()),
    durationMinutes: z.number().int().positive().max(120),
    groupSize: z.number().int().min(1).max(5),
    venueRequirements: z.array(z.string()),
    proposedTimeWindow: availabilityWindowSchema,
  }),
  proposedParticipants: z.array(z.object({
    candidateId: z.string().min(1),
    proposedRole: z.string().min(1),
    needsAddressed: z.array(z.string()),
    contributionsUsed: z.array(z.string()),
  })).min(1).max(5),
  reserveCandidates: z.array(z.object({
    candidateId: z.string().min(1),
    possibleRole: z.string().min(1),
    reason: z.string().min(1),
  })),
  mutualBenefitExplanation: z.array(z.string()),
  confidence: z.number().min(0).max(1),
}) satisfies z.ZodType<QuestProposal>;

export const questSynthesisOutputSchema = z.object({
  outcome: z.enum(["proposal", "no_match"]),
  proposal: questProposalSchema.nullable(),
  primaryIntentRef: z.string().nullable(),
  reason: z.string().nullable(),
  missingCapabilities: z.array(z.string().min(1)),
});

export type QuestSynthesisOutput =
  | { outcome: "proposal"; proposal: QuestProposal; primaryIntentRef: string }
  | { outcome: "no_match"; reason: string; missingCapabilities: string[] };

export const safetyReviewSchema = z.object({
  status: z.enum(["approved", "rejected", "human_review"]),
  riskLevel: z.enum(["low", "medium", "high"]),
  conditions: z.array(z.string()),
  requiresHumanReview: z.boolean(),
}) satisfies z.ZodType<SafetyReview>;

export const recoveryActionSchema = z.object({
  replacementCandidateId: z.string().nullable(),
});

export const memoryUpdateRequestSchema = candidateProfileSchema
  .omit({ need: true, interests: true, offers: true })
  .extend({
    need: z.string().min(3).optional(),
    interests: z.array(z.string()).optional(),
    offers: z.array(z.string()).optional(),
    narrative: z.string().min(3).optional(),
  })
  .refine((value) => value.need !== undefined || value.narrative !== undefined, {
    message: "Either need or narrative is required",
    path: ["narrative"],
  })
  .transform((value): MemoryUpdateCommand => {
    const { narrative, ...candidate } = value;
    const need = candidate.need ?? narrative ?? "";
    return {
      profile: candidateProfileSchema.parse({
        ...candidate,
        need,
        interests: candidate.interests ?? [],
        offers: candidate.offers ?? [],
      }),
      narrative: narrative ?? need,
      providedSoftFacts: {
        need: candidate.need !== undefined,
        interests: candidate.interests !== undefined,
        offers: candidate.offers !== undefined,
      },
    };
  });

export const coordinationEventRequestSchema = z.object({
  type: z.enum([
    "participant_accepted",
    "participant_declined",
    "participant_timed_out",
    "quest_completed",
    "quest_cancelled",
  ]),
  candidateId: z.string().min(1).optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});
