import { createHash, randomUUID } from "node:crypto";
import type { AgentRuntime } from "@/server/agents/agent-runtime";
import type { AssistantRecommendationService } from "@/server/features/assistant-recommendation-service";
import {
  assistantAnswerSchema,
  confirmedQuestBriefSchema,
  questBriefDraftSchema,
  type AssistantAnswer,
  type AssistantBriefField,
  type AssistantConversationMessage,
  type AssistantConversationSnapshot,
  type AssistantWorkflowEvent,
  type QuestBriefDraft,
} from "@/server/domain/schemas";
import type { KampungStore } from "@/server/repositories/kampung-store";

const REQUIRED_FIELDS: AssistantBriefField[] = [
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
];

interface AssistantConversationDependencies {
  store: KampungStore;
  agents: AgentRuntime;
  recommendations?: AssistantRecommendationService;
}

export class AssistantConversationService {
  constructor(private readonly dependencies: AssistantConversationDependencies) {}

  async create(input: { candidateId: "maria" }): Promise<AssistantConversationSnapshot> {
    const conversationId = randomUUID();
    const createdAt = new Date().toISOString();
    const brief: QuestBriefDraft = {};
    const turn = await this.dependencies.agents.conductConversation({
      conversationId,
      messages: [],
      brief,
      missingFields: this.missingFields(brief),
    });
    const nextField = this.safeNextField(turn.requestedField, brief);
    const snapshot: AssistantConversationSnapshot = {
      conversationId,
      candidateId: input.candidateId,
      status: "collecting",
      revision: 1,
      messages: [this.message("assistant", turn.reply)],
      brief,
      nextField,
      suggestedReplies: turn.suggestedReplies,
      questRunId: null,
      events: [],
      error: null,
      createdAt,
      updatedAt: createdAt,
    };
    return this.dependencies.store.createAssistantConversation(snapshot);
  }

  get(conversationId: string): Promise<AssistantConversationSnapshot | null> {
    return this.dependencies.store.findAssistantConversation(conversationId);
  }

  async addTurn(
    conversationId: string,
    command: { clientTurnId: string; revision: number; answer: AssistantAnswer },
  ): Promise<AssistantConversationSnapshot> {
    const answer = assistantAnswerSchema.parse(command.answer);
    const current = await this.requireConversation(conversationId);
    if (current.messages.some((message) => message.messageId === command.clientTurnId)) return current;
    if (current.revision !== command.revision) {
      throw new Error("Assistant conversation conflict; reload and retry");
    }
    if (!["collecting", "ready_for_review", "no_match"].includes(current.status)) {
      throw new Error("Assistant conversation is not accepting answers");
    }

    const brief = questBriefDraftSchema.parse(this.applyAnswer(current.brief, answer));
    const userMessage: AssistantConversationMessage = {
      messageId: command.clientTurnId,
      role: "user",
      content: this.displayAnswer(answer),
      createdAt: new Date().toISOString(),
    };
    const messages = [...current.messages, userMessage];
    const missingFields = this.missingFields(brief);
    const turn = await this.dependencies.agents.conductConversation({
      conversationId,
      messages,
      brief,
      missingFields,
    });
    const patchedBrief = questBriefDraftSchema.parse(this.applySafePatch(brief, turn.briefPatch));
    const remaining = this.missingFields(patchedBrief);
    const ready = remaining.length === 0;
    const updated: AssistantConversationSnapshot = {
      ...current,
      status: ready ? "ready_for_review" : "collecting",
      revision: current.revision + 1,
      messages: [...messages, this.message("assistant", turn.reply)],
      brief: patchedBrief,
      nextField: ready ? null : this.safeNextField(turn.requestedField, patchedBrief),
      suggestedReplies: turn.suggestedReplies,
      questRunId: current.status === "no_match" ? null : current.questRunId,
      events: current.status === "no_match" ? [] : current.events,
      error: null,
      updatedAt: new Date().toISOString(),
    };
    return this.dependencies.store.saveAssistantConversation(updated, current.revision);
  }

  confirmedBrief(snapshot: AssistantConversationSnapshot) {
    if (snapshot.status !== "ready_for_review" && snapshot.status !== "failed") {
      throw new Error("Assistant conversation is not ready for confirmation");
    }
    const brief = confirmedQuestBriefSchema.parse(snapshot.brief);
    if (!brief.invitationConsent) throw new Error("Invitation consent is required");
    return brief;
  }

  async confirm(
    conversationId: string,
    command: { revision: number },
    onEvent?: (event: AssistantWorkflowEvent) => Promise<void> | void,
  ): Promise<AssistantConversationSnapshot> {
    let current = await this.requireConversation(conversationId);
    if (["processing", "complete", "no_match"].includes(current.status)) return current;
    if (current.revision !== command.revision) {
      throw new Error("Assistant conversation conflict; reload and retry");
    }
    const recommendationService = this.dependencies.recommendations;
    if (!recommendationService) throw new Error("Assistant recommendation workflow is unavailable");
    const brief = this.confirmedBrief(current);

    current = await this.saveWithEvent({
      ...current,
      status: "processing",
      revision: current.revision + 1,
      nextField: null,
      suggestedReplies: [],
      error: null,
      updatedAt: new Date().toISOString(),
    }, current.revision, {
      stage: "brief",
      status: "completed",
      message: "Senior Quest confirmed the current request",
      kind: "agent",
    }, onEvent);

    try {
      const result = await recommendationService.recommend({
        conversationId: current.conversationId,
        requestKey: `${current.conversationId}:${createHash("sha256").update(JSON.stringify(brief)).digest("hex").slice(0, 12)}`,
        candidateId: current.candidateId,
        narrative: brief.currentGoal,
        interests: brief.interests,
        offers: brief.offers,
        constraints: {
          availableWindows: brief.availableWindows,
          maximumDistanceM: brief.maximumDistanceM,
          minimumGroupSize: brief.minimumGroupSize,
          maximumGroupSize: brief.maximumGroupSize,
          indoorRequired: brief.indoorRequired,
          stairsAllowed: brief.stairsAllowed,
          dietaryRequirements: [],
          languages: [brief.language],
          verified: true,
          invitationConsent: brief.invitationConsent,
        },
      }, async (event) => {
        current = await this.saveWithEvent({
          ...current,
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
        }, current.revision, event, onEvent);
      });
      const finalStatus = result.quest.status === "no_match" ? "no_match" : "complete";
      const completed: AssistantConversationSnapshot = {
        ...current,
        status: finalStatus,
        revision: current.revision + 1,
        questRunId: result.quest.runId,
        updatedAt: new Date().toISOString(),
      };
      return this.dependencies.store.saveAssistantConversation(completed, current.revision);
    } catch (error) {
      const failed: AssistantConversationSnapshot = {
        ...current,
        status: "failed",
        revision: current.revision + 1,
        error: error instanceof Error ? error.message : "Quest preparation failed",
        updatedAt: new Date().toISOString(),
      };
      return this.dependencies.store.saveAssistantConversation(failed, current.revision);
    }
  }

  private async requireConversation(conversationId: string): Promise<AssistantConversationSnapshot> {
    const conversation = await this.dependencies.store.findAssistantConversation(conversationId);
    if (!conversation) throw new Error("Assistant conversation was not found");
    return conversation;
  }

  private async saveWithEvent(
    snapshot: AssistantConversationSnapshot,
    expectedRevision: number,
    event: Omit<AssistantWorkflowEvent, "sequence" | "createdAt">,
    onEvent?: (event: AssistantWorkflowEvent) => Promise<void> | void,
  ): Promise<AssistantConversationSnapshot> {
    const workflowEvent: AssistantWorkflowEvent = {
      ...event,
      sequence: (snapshot.events.at(-1)?.sequence ?? 0) + 1,
      createdAt: new Date().toISOString(),
    };
    const saved = await this.dependencies.store.saveAssistantConversation({
      ...snapshot,
      events: [...snapshot.events, workflowEvent],
    }, expectedRevision);
    await onEvent?.(workflowEvent);
    return saved;
  }

  private missingFields(brief: QuestBriefDraft): AssistantBriefField[] {
    return REQUIRED_FIELDS.filter((field) => {
      if (field === "goal") return !brief.currentGoal;
      if (field === "interests") return brief.interests === undefined;
      if (field === "offers") return brief.offers === undefined;
      if (field === "availability") return !brief.availableWindows?.length;
      if (field === "group_size") {
        return brief.minimumGroupSize === undefined || brief.maximumGroupSize === undefined;
      }
      if (field === "indoor") return brief.indoorRequired === undefined;
      if (field === "stairs") return brief.stairsAllowed === undefined;
      if (field === "distance") return brief.maximumDistanceM === undefined;
      if (field === "language") return !brief.language;
      return brief.invitationConsent === undefined;
    });
  }

  private safeNextField(
    requestedField: AssistantBriefField | null,
    brief: QuestBriefDraft,
  ): AssistantBriefField | null {
    const missing = this.missingFields(brief);
    if (missing.length === 0) return null;
    return requestedField && missing.includes(requestedField) ? requestedField : missing[0];
  }

  private applyAnswer(brief: QuestBriefDraft, answer: AssistantAnswer): QuestBriefDraft {
    if (answer.field === "goal") return { ...brief, currentGoal: answer.value };
    if (answer.field === "interests") return { ...brief, interests: answer.value ? [answer.value] : [] };
    if (answer.field === "offers") return { ...brief, offers: answer.value ? [answer.value] : [] };
    if (answer.field === "availability") return { ...brief, availableWindows: [answer.value] };
    if (answer.field === "group_size") {
      return { ...brief, minimumGroupSize: answer.value.minimum, maximumGroupSize: answer.value.maximum };
    }
    if (answer.field === "indoor") return { ...brief, indoorRequired: answer.value };
    if (answer.field === "stairs") return { ...brief, stairsAllowed: answer.value };
    if (answer.field === "distance") return { ...brief, maximumDistanceM: answer.value };
    if (answer.field === "language") return { ...brief, language: answer.value };
    return { ...brief, invitationConsent: answer.value };
  }

  private applySafePatch(brief: QuestBriefDraft, patch: QuestBriefDraft): QuestBriefDraft {
    return {
      ...brief,
      currentGoal: brief.currentGoal ?? patch.currentGoal,
      interests: brief.interests ?? patch.interests,
      offers: brief.offers ?? patch.offers,
    };
  }

  private displayAnswer(answer: AssistantAnswer): string {
    if (answer.field === "availability") {
      return `${answer.value.start} to ${answer.value.end}`;
    }
    if (answer.field === "group_size") {
      return `${answer.value.minimum}–${answer.value.maximum} people`;
    }
    if (answer.field === "distance") return `Up to ${answer.value} metres`;
    if (answer.field === "indoor") return answer.value ? "Indoors, please" : "Indoor or outdoor";
    if (answer.field === "stairs") return answer.value ? "Stairs are comfortable" : "No stairs, please";
    if (answer.field === "consent") return answer.value ? "Yes, please find a quest" : "Not yet";
    return answer.value ?? "Nothing specific";
  }

  private message(role: "user" | "assistant", content: string): AssistantConversationMessage {
    return {
      messageId: randomUUID(),
      role,
      content,
      createdAt: new Date().toISOString(),
    };
  }
}
