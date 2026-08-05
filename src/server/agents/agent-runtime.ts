import type {
  AssistantBriefField,
  AssistantConversationMessage,
  AssistantTurnAgentOutput,
  CandidateProfile,
  AgentRunAudit,
  MemoryAgentOutput,
  MemoryCard,
  QuestProposal,
  QuestSynthesisOutput,
  RetrievedCandidate,
  SafetyReview,
  QuestRun,
  QuestBriefDraft,
  ValidationErrorItem,
} from "@/server/domain/schemas";
import type { CoordinationIntent, CoordinationRequirements, EventAppointmentSuggestion, EventArrangement } from "@/server/domain/event-coordination";

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
  auditContext?: Record<string, string>;
}

export interface AgentRuntime {
  conductConversation(input: {
    conversationId: string;
    messages: AssistantConversationMessage[];
    brief: QuestBriefDraft;
    missingFields: AssistantBriefField[];
  }): Promise<AssistantTurnAgentOutput>;
  updateMemory(input: MemoryAgentInput): Promise<MemoryAgentOutput>;
  synthesizeQuest(input: {
    initiator: CandidateProfile;
    candidates: RetrievedCandidate[];
    validationErrors?: ValidationErrorItem[];
    proposalToCorrect?: QuestProposal;
    auditContext?: Record<string, string>;
  }): Promise<QuestSynthesisOutput>;
  reviewSafety(input: {
    proposal: QuestProposal;
    profiles: Map<string, CandidateProfile>;
    auditContext?: Record<string, string>;
  }): Promise<SafetyReview>;
  recoverQuest(input: {
    run: QuestRun;
    unavailableCandidateId: string;
  }): Promise<{ replacementCandidateId: string | null }>;
  coordinateEvent(input: {
    quest: { title: string; description: string; durationMinutes: number };
    messages: Array<{ role: "participant" | "assistant" | "system"; body: string }>;
    currentRequirements: CoordinationRequirements;
    currentAppointment?: Pick<EventArrangement, "version" | "start" | "end" | "venueName" | "status"> | null;
    latestSuggestion?: Pick<EventAppointmentSuggestion, "suggestionId" | "alternative" | "expiresAt"> | null;
    timeZone?: string;
    scope?: "private" | "group";
    latestMessage: string;
    auditContext?: Record<string, string>;
  }): Promise<{
    reply: string;
    requirementPatch: Partial<CoordinationRequirements>;
    intent: CoordinationIntent;
  }>;
}
