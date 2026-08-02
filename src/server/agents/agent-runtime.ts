import type {
  CandidateProfile,
  AgentRunAudit,
  MemoryAgentOutput,
  MemoryCard,
  QuestProposal,
  RetrievedCandidate,
  SafetyReview,
  QuestRun,
  ValidationErrorItem,
} from "@/server/domain/schemas";

export type AgentAuditSink = (record: AgentRunAudit) => Promise<void>;

export interface MemoryAgentInput {
  profile: CandidateProfile;
  narrative: string;
  currentMemory: MemoryCard | null;
  providedSoftFacts?: {
    need: boolean;
    interests: boolean;
    offers: boolean;
  };
}

export interface AgentRuntime {
  updateMemory(input: MemoryAgentInput): Promise<MemoryAgentOutput>;
  synthesizeQuest(input: {
    initiator: CandidateProfile;
    candidates: RetrievedCandidate[];
    validationErrors?: ValidationErrorItem[];
    proposalToCorrect?: QuestProposal;
  }): Promise<QuestProposal>;
  reviewSafety(input: {
    proposal: QuestProposal;
    profiles: Map<string, CandidateProfile>;
  }): Promise<SafetyReview>;
  recoverQuest(input: {
    run: QuestRun;
    unavailableCandidateId: string;
  }): Promise<{ replacementCandidateId: string | null }>;
}
