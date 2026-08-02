import { describe, expect, it } from "vitest";
import {
  assistantConversationReducer,
  createAssistantConversation,
  toRecommendationRequest,
} from "@/features/assistant/conversation";

describe("assistant conversation", () => {
  it("rejects an incomplete conversation", () => {
    expect(() => toRecommendationRequest(createAssistantConversation("conversation_001")))
      .toThrow("The assistant conversation is incomplete");
  });

  it("does not accept an availability window that ends before it starts", () => {
    const availability = {
      ...createAssistantConversation("conversation_001"),
      step: "availability" as const,
      narrative: "Lunch company",
    };
    const result = assistantConversationReducer(availability, {
      type: "set_availability",
      start: "2026-08-03T14:00:00.000Z",
      end: "2026-08-03T11:00:00.000Z",
    });

    expect(result).toEqual(availability);
  });

  it("restores a draft and lets Maria edit an earlier answer", () => {
    let draft = createAssistantConversation("conversation_001");
    draft = assistantConversationReducer(draft, {
      type: "answer_text",
      value: "I would like company for lunch.",
    });
    draft = assistantConversationReducer(draft, {
      type: "answer_text",
      value: "Cooking",
    });

    let restored = createAssistantConversation("different_conversation");
    restored = assistantConversationReducer(restored, { type: "restore", state: draft });
    restored = assistantConversationReducer(restored, { type: "edit", step: "need" });
    restored = assistantConversationReducer(restored, {
      type: "answer_text",
      value: "I would like a gentle walk with friendly neighbours.",
    });

    expect(restored.conversationId).toBe("conversation_001");
    expect(restored.narrative).toBe("I would like a gentle walk with friendly neighbours.");
    expect(restored.step).toBe("interests");
  });

  it("collects natural language and confirmed constraints into an engine request", () => {
    let state = createAssistantConversation("conversation_001");
    state = assistantConversationReducer(state, {
      type: "answer_text",
      value: "I would enjoy company over a healthy lunch.",
    });
    state = assistantConversationReducer(state, {
      type: "answer_text",
      value: "Healthy cooking and meeting neighbours",
    });
    state = assistantConversationReducer(state, {
      type: "answer_text",
      value: "I can bring fruit",
    });
    state = assistantConversationReducer(state, {
      type: "set_availability",
      start: "2026-08-03T03:00:00.000Z",
      end: "2026-08-03T06:00:00.000Z",
    });
    state = assistantConversationReducer(state, { type: "set_group_size", minimum: 2, maximum: 4 });
    state = assistantConversationReducer(state, { type: "set_setting", indoorRequired: true });
    state = assistantConversationReducer(state, { type: "set_stairs", stairsAllowed: false });
    state = assistantConversationReducer(state, { type: "set_distance", maximumDistanceM: 1000 });
    state = assistantConversationReducer(state, { type: "set_language", language: "English" });
    state = assistantConversationReducer(state, { type: "set_consent", invitationConsent: true });

    expect(state.step).toBe("review");
    expect(toRecommendationRequest(state)).toEqual(expect.objectContaining({
      conversationId: "conversation_001",
      candidateId: "maria",
      narrative: "I would enjoy company over a healthy lunch.",
      interests: ["Healthy cooking and meeting neighbours"],
      offers: ["I can bring fruit"],
      constraints: expect.objectContaining({
        maximumDistanceM: 1000,
        minimumGroupSize: 2,
        maximumGroupSize: 4,
        indoorRequired: true,
        stairsAllowed: false,
        languages: ["English"],
        invitationConsent: true,
      }),
    }));
  });
});
