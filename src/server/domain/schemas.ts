import { z } from "zod";

export const availabilityWindowSchema = z
  .object({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
  })
  .refine((window) => Date.parse(window.end) > Date.parse(window.start), {
    message: "Availability end must be after start",
    path: ["end"],
  });

export const constraintsSchema = z
  .object({
    availableWindows: z.array(availabilityWindowSchema).min(1),
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
export type CandidateProfile = z.infer<typeof candidateProfileSchema>;

export const assistantRecommendationRequestSchema = z.object({
  conversationId: z.string().min(1),
  candidateId: z.string().min(1),
  narrative: z.string().min(3),
  interests: z.array(z.string().min(1)).default([]),
  offers: z.array(z.string().min(1)).default([]),
  constraints: constraintsSchema,
});

export type AssistantRecommendationCommand = z.infer<typeof assistantRecommendationRequestSchema>;

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
}

export interface QuestRun {
  runId: string;
  initiatingCandidateId: string;
  idempotencyKey: string | null;
  status: QuestStatus;
  proposal: QuestProposal | null;
  validation: ValidationResult | null;
  safety: SafetyReview | null;
  coordination: CoordinationPlan | null;
  createdAt: string;
  updatedAt: string;
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
    groupSize: z.number().int().min(2).max(5),
    venueRequirements: z.array(z.string()),
    proposedTimeWindow: availabilityWindowSchema,
  }),
  proposedParticipants: z.array(z.object({
    candidateId: z.string().min(1),
    proposedRole: z.string().min(1),
    needsAddressed: z.array(z.string()),
    contributionsUsed: z.array(z.string()),
  })).min(2).max(5),
  reserveCandidates: z.array(z.object({
    candidateId: z.string().min(1),
    possibleRole: z.string().min(1),
    reason: z.string().min(1),
  })),
  mutualBenefitExplanation: z.array(z.string()),
  confidence: z.number().min(0).max(1),
}) satisfies z.ZodType<QuestProposal>;

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
