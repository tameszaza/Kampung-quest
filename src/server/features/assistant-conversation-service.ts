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
  type AssistantRecommendationCommand,
  type AssistantWorkflowEvent,
  type QuestBriefDraft,
} from "@/server/domain/schemas";
import type { KampungStore } from "@/server/repositories/kampung-store";
import type { AccessibilityPreferences } from "@/server/identity/types";
import { logger, safeErrorMessage } from "@/server/observability/logger";

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

const ASSISTANT_QUESTIONS: Record<AssistantBriefField, string> = {
  goal: "What would feel helpful or enjoyable for your next quest?",
  interests: "What interests would you like this quest to include?",
  offers: "Is there anything you would enjoy contributing?",
  availability: "When are you generally available? You can share several times or a weekly pattern; this will not schedule the activity yet.",
  group_size: "What group size would feel comfortable for this activity?",
  indoor: "Would you prefer an indoor setting?",
  stairs: "Are stairs comfortable for you?",
  distance: "How far would you be comfortable travelling?",
  language: "Which language should the group use?",
  consent: "May I use these details to look for suitable neighbours?",
};

function assistantQuestionForField(field: AssistantBriefField) {
  return ASSISTANT_QUESTIONS[field];
}

interface AssistantConversationDependencies {
  store: KampungStore;
  agents: AgentRuntime;
  recommendations?: AssistantRecommendationService;
  allowDemoNeighbors?: (candidateId: string) => Promise<boolean>;
  resolveAccessibilityPreferences?: (candidateId: string) => Promise<AccessibilityPreferences | null>;
  wait?: (milliseconds: number) => Promise<void>;
}

export class AssistantConversationService {
  private readonly turnQueues = new Map<string, Promise<unknown>>();

  constructor(private readonly dependencies: AssistantConversationDependencies) {}

  private enqueueTurn(conversationId: string, task: () => Promise<unknown>): Promise<unknown> {
    const previous = this.turnQueues.get(conversationId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.turnQueues.set(conversationId, next);
    void next.then(
      () => {
        if (this.turnQueues.get(conversationId) === next) this.turnQueues.delete(conversationId);
      },
      () => {
        if (this.turnQueues.get(conversationId) === next) this.turnQueues.delete(conversationId);
      },
    );
    return next;
  }

  async create(input: { candidateId: string }): Promise<AssistantConversationSnapshot> {
    const conversationId = randomUUID();
    const createdAt = new Date().toISOString();
    const savedAccessibility = await this.savedAccessibilityPreferences(input.candidateId);
    const brief: QuestBriefDraft = this.applySavedAccessibilityPreferences({}, savedAccessibility);
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
    command: { clientTurnId: string; revision: number; answer: AssistantAnswer; waitForAgent?: boolean },
  ): Promise<AssistantConversationSnapshot> {
    const answer = assistantAnswerSchema.parse(command.answer);
    const current = await this.requireConversation(conversationId);
    const existingMessageIndex = current.messages.findIndex(
      (message) => message.messageId === command.clientTurnId,
    );
    if (existingMessageIndex >= 0 && current.status === "processing") return current;
    if (existingMessageIndex >= 0 && current.messages[existingMessageIndex + 1]?.role === "assistant") {
      return current;
    }
    if (current.revision !== command.revision) {
      throw new Error("Assistant conversation conflict; reload and retry");
    }
    if (!["collecting", "ready_for_review", "no_match"].includes(current.status)) {
      throw new Error("Assistant conversation is not accepting answers");
    }

    const brief = existingMessageIndex >= 0
      ? current.brief
      : questBriefDraftSchema.parse(this.applyAnswer(current.brief, answer));
    const messages = existingMessageIndex >= 0
      ? current.messages
      : [...current.messages, {
          messageId: command.clientTurnId,
          role: "user" as const,
          content: this.displayAnswer(answer),
          createdAt: new Date().toISOString(),
        }];
    const pending = existingMessageIndex >= 0
      ? current
      : await this.dependencies.store.saveAssistantConversation({
          ...current,
          revision: current.revision + 1,
          messages,
          brief,
          error: null,
          updatedAt: new Date().toISOString(),
        }, current.revision);
    const missingFields = this.missingFields(brief);
    const processTurn = async (agentPending = pending) => {
      let turn;
      try {
        turn = await this.dependencies.agents.conductConversation({
          conversationId,
          messages,
          brief,
          missingFields,
        });
      } catch (error) {
        await this.dependencies.store.saveAssistantConversation({
          ...agentPending,
          status: pending.status,
          nextField: pending.nextField,
          suggestedReplies: pending.suggestedReplies,
          revision: agentPending.revision + 1,
          error: error instanceof Error ? error.message : "Senior Quest could not respond",
          updatedAt: new Date().toISOString(),
        }, agentPending.revision);
        throw error;
      }
      const patchedBrief = questBriefDraftSchema.parse(this.applySafePatch(brief, turn.briefPatch, answer.field));
      const remaining = this.missingFields(patchedBrief);
      const ready = remaining.length === 0;
      const nextField = this.safeNextField(turn.requestedField, patchedBrief);
      const reconciledTurn = this.reconcileTurn(turn, nextField, patchedBrief);
      const updated: AssistantConversationSnapshot = {
        ...agentPending,
        status: ready ? "ready_for_review" : "collecting",
        revision: agentPending.revision + 1,
        messages: [...messages, this.message("assistant", reconciledTurn.reply)],
        brief: patchedBrief,
        nextField: ready ? null : nextField,
        suggestedReplies: reconciledTurn.suggestedReplies,
        questRunId: current.status === "no_match" ? null : agentPending.questRunId,
        events: current.status === "no_match" ? [] : agentPending.events,
        error: null,
        updatedAt: new Date().toISOString(),
      };
      return this.dependencies.store.saveAssistantConversation(updated, agentPending.revision);
    };
    if (command.waitForAgent === false) {
      const processing = await this.dependencies.store.saveAssistantConversation({
        ...pending,
        status: "processing",
        revision: pending.revision + 1,
        nextField: null,
        suggestedReplies: [],
        error: null,
        updatedAt: new Date().toISOString(),
      }, pending.revision);
      const backgroundStartedAt = performance.now();
      void this.enqueueTurn(conversationId, async () => {
        const result = await processTurn(processing);
        logger.info("assistant.turn.background_completed", {
          conversationId,
          clientTurnId: command.clientTurnId,
          durationMs: Math.round(performance.now() - backgroundStartedAt),
        });
        return result;
      }).catch((error) => logger.error("assistant.turn.background_failed", {
        conversationId,
        clientTurnId: command.clientTurnId,
        durationMs: Math.round(performance.now() - backgroundStartedAt),
        error: safeErrorMessage(error),
      }));
      return processing;
    }
    return processTurn();
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

    try {
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
    } catch (error) {
      const latest = await this.requireConversation(conversationId);
      if (["processing", "complete", "no_match"].includes(latest.status)) return latest;
      throw error;
    }

    try {
      const recommendationCommand: AssistantRecommendationCommand = {
        conversationId: current.conversationId,
        requestKey: `${current.conversationId}:${createHash("sha256").update(JSON.stringify(brief)).digest("hex").slice(0, 12)}`,
        candidateId: current.candidateId,
        narrative: brief.currentGoal,
        interests: brief.interests,
        offers: brief.offers,
        constraints: {
          availableWindows: brief.availableWindows,
          recurringAvailabilityRules: brief.recurringAvailabilityRules,
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
      };
      const observeRecommendation = async (event: Omit<AssistantWorkflowEvent, "sequence" | "createdAt">) => {
        current = await this.saveWithEvent({
          ...current,
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
        }, current.revision, event, onEvent);
      };
      let result;
      try {
        result = await recommendationService.recommend(recommendationCommand, observeRecommendation, {
          allowDemoNeighbors: this.dependencies.allowDemoNeighbors
            ? await this.dependencies.allowDemoNeighbors(current.candidateId)
            : undefined,
        });
      } catch (error) {
        const failedEvent = current.events.at(-1);
        const rateLimited = this.isRateLimitFailure(error);
        const retryableStage = failedEvent?.status === "failed"
          && (rateLimited || failedEvent.stage === "synthesis" || failedEvent.stage === "safety");
        const retryDelayMs = this.providerRetryDelayMs(error);
        if (!retryableStage || retryDelayMs === null) throw error;
        current = await this.saveWithEvent({
          ...current,
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
        }, current.revision, {
          stage: failedEvent.stage,
          status: "started",
          message: rateLimited
            ? `Gemini is busy; retrying once in ${Math.ceil(retryDelayMs / 1_000)} seconds`
            : `${failedEvent.stage === "safety" ? "Safety Guardian" : "Matchmaker"} was interrupted; retrying once`,
          kind: "agent",
        }, onEvent);
        if (retryDelayMs > 0) await (this.dependencies.wait ?? wait)(retryDelayMs);
        result = await recommendationService.recommend(recommendationCommand, observeRecommendation, {
          allowDemoNeighbors: this.dependencies.allowDemoNeighbors
            ? await this.dependencies.allowDemoNeighbors(current.candidateId)
            : undefined,
        });
      }
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

  private async savedAccessibilityPreferences(candidateId: string): Promise<AccessibilityPreferences | null> {
    if (!this.dependencies.resolveAccessibilityPreferences) return null;
    try {
      return await this.dependencies.resolveAccessibilityPreferences(candidateId);
    } catch {
      // An optional preference lookup must never make Senior Quest unavailable.
      return null;
    }
  }

  private applySavedAccessibilityPreferences(
    brief: QuestBriefDraft,
    preferences: AccessibilityPreferences | null,
  ): QuestBriefDraft {
    if (!preferences) return brief;
    const maximumDistanceM = typeof preferences.maximumDistanceM === "number"
      && Number.isInteger(preferences.maximumDistanceM)
      && preferences.maximumDistanceM > 0
      ? preferences.maximumDistanceM
      : null;
    const language = preferences.language?.trim() || null;
    return {
      ...brief,
      ...(brief.stairsAllowed === undefined && preferences.stairsAllowed !== null
        ? { stairsAllowed: preferences.stairsAllowed }
        : {}),
      ...(brief.maximumDistanceM === undefined && maximumDistanceM !== null
        ? { maximumDistanceM }
        : {}),
      ...(brief.language === undefined && language !== null
        ? { language }
        : {}),
    };
  }

  private safeNextField(
    requestedField: AssistantBriefField | null,
    brief: QuestBriefDraft,
  ): AssistantBriefField | null {
    const missing = this.missingFields(brief);
    if (missing.length === 0) return null;
    return requestedField && missing.includes(requestedField) ? requestedField : missing[0];
  }

  private reconcileTurn(
    turn: Awaited<ReturnType<AgentRuntime["conductConversation"]>>,
    nextField: AssistantBriefField | null,
    brief: QuestBriefDraft,
  ) {
    const staleAvailabilityQuestion = Boolean(
      brief.availableWindows?.length
      && nextField !== "availability"
      && /\?/.test(turn.reply)
      && /(?:what|which|when|could you|tell me).*?(?:day|date|time|availability|available)/i.test(turn.reply),
    );
    if (turn.requestedField === nextField && !staleAvailabilityQuestion) return turn;
    return {
      ...turn,
      reply: nextField ? assistantQuestionForField(nextField) : "I have enough information to prepare your quest brief.",
      requestedField: nextField,
      suggestedReplies: [],
      status: nextField ? "collecting" as const : "ready_for_review" as const,
    };
  }

  private applyAnswer(brief: QuestBriefDraft, answer: AssistantAnswer): QuestBriefDraft {
    if (answer.field === "goal") return { ...brief, currentGoal: answer.value };
    if (answer.field === "interests") return { ...brief, interests: answer.value ? [answer.value] : [] };
    if (answer.field === "offers") return { ...brief, offers: answer.value ? [answer.value] : [] };
    if (answer.field === "availability") {
      if ("start" in answer.value) return { ...brief, availableWindows: [answer.value], recurringAvailabilityRules: [] };
      return {
        ...brief,
        availableWindows: answer.value.availableWindows,
        recurringAvailabilityRules: answer.value.recurringAvailabilityRules,
      };
    }
    if (answer.field === "group_size") {
      return { ...brief, minimumGroupSize: answer.value.minimum, maximumGroupSize: answer.value.maximum };
    }
    if (answer.field === "indoor") return { ...brief, indoorRequired: answer.value };
    if (answer.field === "stairs") return { ...brief, stairsAllowed: answer.value };
    if (answer.field === "distance") return { ...brief, maximumDistanceM: answer.value };
    if (answer.field === "language") return { ...brief, language: answer.value };
    return { ...brief, invitationConsent: answer.value };
  }

  private applySafePatch(
    brief: QuestBriefDraft,
    patch: QuestBriefDraft,
    answeredField: AssistantAnswer["field"],
  ): QuestBriefDraft {
    return {
      ...brief,
      // Only accept a model-extracted soft fact when that same field was the
      // user's explicit answer. A consent reply such as "not yet" must never
      // be reinterpreted as a new goal or other request detail.
      currentGoal: answeredField === "goal" ? (brief.currentGoal ?? patch.currentGoal) : brief.currentGoal,
      interests: answeredField === "interests" ? (brief.interests ?? patch.interests) : brief.interests,
      offers: answeredField === "offers" ? (brief.offers ?? patch.offers) : brief.offers,
    };
  }

  private displayAnswer(answer: AssistantAnswer): string {
    if (answer.field === "availability") {
      const windows = "start" in answer.value ? [answer.value] : answer.value.availableWindows;
      const recurring = "start" in answer.value ? [] : answer.value.recurringAvailabilityRules;
      return recurring.length
        ? `${recurring.length} weekly availability pattern${recurring.length === 1 ? "" : "s"}`
        : `${windows.length} available time${windows.length === 1 ? "" : "s"}`;
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

  private providerRetryDelayMs(error: unknown): number | null {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (/daily (?:request )?quota|daily limit|resets at midnight/.test(message)) return null;
    if (this.isRateLimitFailure(error)) {
      const hint = message.match(/(?:about|in)\s+([0-9]+)\s+seconds?/);
      return Math.min(Number(hint?.[1] ?? 5) * 1_000, 60_000);
    }
    return /timed? out|timeout|connection reset|econnreset|fetch failed|service unavailable|\b503\b/.test(message)
      ? 0
      : null;
  }

  private isRateLimitFailure(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return /quota|rate limit|too many requests|\b429\b/.test(message);
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
