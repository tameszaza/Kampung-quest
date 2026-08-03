import type { AssistantRecommendationCommand } from "@/server/domain/schemas";

export type AssistantStep =
  | "need"
  | "interests"
  | "offers"
  | "availability"
  | "group_size"
  | "setting"
  | "stairs"
  | "distance"
  | "language"
  | "consent"
  | "review"
  | "submitting"
  | "complete";

export interface AssistantConversationState {
  conversationId: string;
  step: AssistantStep;
  narrative: string;
  interests: string[];
  offers: string[];
  availableStart?: string;
  availableEnd?: string;
  minimumGroupSize?: number;
  maximumGroupSize?: number;
  indoorRequired?: boolean;
  stairsAllowed?: boolean;
  maximumDistanceM?: number;
  language?: string;
  invitationConsent?: boolean;
  questRunId?: string;
  error?: string;
}

export type AssistantConversationAction =
  | { type: "answer_text"; value: string }
  | { type: "skip_text" }
  | { type: "set_availability"; start: string; end: string }
  | { type: "set_group_size"; minimum: number; maximum: number }
  | { type: "set_setting"; indoorRequired: boolean }
  | { type: "set_stairs"; stairsAllowed: boolean }
  | { type: "set_distance"; maximumDistanceM: number }
  | { type: "set_language"; language: string }
  | { type: "set_consent"; invitationConsent: boolean }
  | { type: "edit"; step: Exclude<AssistantStep, "submitting" | "complete"> }
  | { type: "submission_started" }
  | { type: "submission_failed"; error: string }
  | { type: "submission_succeeded"; questRunId: string }
  | { type: "restore"; state: AssistantConversationState }
  | { type: "reset"; conversationId: string };

export function createAssistantConversation(conversationId: string): AssistantConversationState {
  return {
    conversationId,
    step: "need",
    narrative: "",
    interests: [],
    offers: [],
  };
}

export function assistantConversationReducer(
  state: AssistantConversationState,
  action: AssistantConversationAction,
): AssistantConversationState {
  if (action.type === "reset") return createAssistantConversation(action.conversationId);
  if (action.type === "restore") return action.state;
  if (action.type === "edit") return { ...state, step: action.step, error: undefined };
  if (action.type === "submission_started") return { ...state, step: "submitting", error: undefined };
  if (action.type === "submission_failed") return { ...state, step: "review", error: action.error };
  if (action.type === "submission_succeeded") {
    return { ...state, step: "complete", questRunId: action.questRunId, error: undefined };
  }

  if (action.type === "answer_text") {
    const value = action.value.trim();
    if (!value) return state;
    if (state.step === "need") return { ...state, narrative: value, step: "interests" };
    if (state.step === "interests") return { ...state, interests: [value], step: "offers" };
    if (state.step === "offers") return { ...state, offers: [value], step: "availability" };
    return state;
  }
  if (action.type === "skip_text") {
    if (state.step === "interests") return { ...state, interests: [], step: "offers" };
    if (state.step === "offers") return { ...state, offers: [], step: "availability" };
    return state;
  }
  if (action.type === "set_availability" && state.step === "availability") {
    if (Date.parse(action.end) <= Date.parse(action.start)) return state;
    return { ...state, availableStart: action.start, availableEnd: action.end, step: "group_size" };
  }
  if (action.type === "set_group_size" && state.step === "group_size") {
    return {
      ...state,
      minimumGroupSize: action.minimum,
      maximumGroupSize: action.maximum,
      step: "setting",
    };
  }
  if (action.type === "set_setting" && state.step === "setting") {
    return { ...state, indoorRequired: action.indoorRequired, step: "stairs" };
  }
  if (action.type === "set_stairs" && state.step === "stairs") {
    return { ...state, stairsAllowed: action.stairsAllowed, step: "distance" };
  }
  if (action.type === "set_distance" && state.step === "distance") {
    return { ...state, maximumDistanceM: action.maximumDistanceM, step: "language" };
  }
  if (action.type === "set_language" && state.step === "language") {
    return { ...state, language: action.language, step: "consent" };
  }
  if (action.type === "set_consent" && state.step === "consent") {
    return { ...state, invitationConsent: action.invitationConsent, step: "review" };
  }
  return state;
}

export function toRecommendationRequest(
  state: AssistantConversationState,
): AssistantRecommendationCommand {
  if (
    !state.narrative
    || !state.availableStart
    || !state.availableEnd
    || state.minimumGroupSize === undefined
    || state.maximumGroupSize === undefined
    || state.indoorRequired === undefined
    || state.stairsAllowed === undefined
    || state.maximumDistanceM === undefined
    || !state.language
    || state.invitationConsent === undefined
  ) {
    throw new Error("The assistant conversation is incomplete");
  }
  return {
    conversationId: state.conversationId,
    candidateId: "maria",
    narrative: state.narrative,
    interests: state.interests,
    offers: state.offers,
    constraints: {
      availableWindows: [{ start: state.availableStart, end: state.availableEnd }],
      maximumDistanceM: state.maximumDistanceM,
      minimumGroupSize: state.minimumGroupSize,
      maximumGroupSize: state.maximumGroupSize,
      indoorRequired: state.indoorRequired,
      stairsAllowed: state.stairsAllowed,
      dietaryRequirements: [],
      languages: [state.language],
      verified: true,
      invitationConsent: state.invitationConsent,
    },
  };
}
