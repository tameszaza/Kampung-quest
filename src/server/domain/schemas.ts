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

export interface MemoryCard {
  profile: CandidateProfile;
  markdown: string;
  updatedAt: string;
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
  state: "awaiting_acceptance";
  invitations: Array<{ candidateId: string; status: "pending" }>;
  nextAction: string;
}

export interface PipelineResult {
  proposal: QuestProposal;
  validation: ValidationResult;
  safety: SafetyReview | null;
  coordination: CoordinationPlan | null;
}
