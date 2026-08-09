import { describe, expect, it } from "vitest";
import { showAssistantTurnThinking, showQuestFindingProgress, showSavedPreferenceRetrieval } from "@/lib/assistant-progress";

describe("assistant progress presentation", () => {
  it("uses the compact thinking state for an ordinary background reply", () => {
    expect(showAssistantTurnThinking("processing", 0, false, false)).toBe(true);
    expect(showQuestFindingProgress("processing", 0, false)).toBe(false);
  });

  it("shows the agent team only after final quest work starts", () => {
    expect(showQuestFindingProgress("processing", 1, false)).toBe(true);
    expect(showAssistantTurnThinking("processing", 1, false, false)).toBe(false);
  });

  it("shows final progress immediately while confirmation begins", () => {
    expect(showQuestFindingProgress("processing", 0, true)).toBe(true);
    expect(showAssistantTurnThinking("processing", 0, true, false)).toBe(false);
  });

  it("keeps explicit submission feedback during a collecting turn", () => {
    expect(showAssistantTurnThinking("collecting", 0, false, true)).toBe(true);
    expect(showQuestFindingProgress("collecting", 0, false)).toBe(false);
  });

  it("retrieves saved preferences immediately before consent", () => {
    expect(showSavedPreferenceRetrieval("collecting", "consent", null, true)).toBe(true);
    expect(showSavedPreferenceRetrieval("collecting", "language", null, true)).toBe(false);
    expect(showSavedPreferenceRetrieval("ready_for_review", null, null, true)).toBe(false);
  });

  it("does not repeat retrieval while editing consent or without saved defaults", () => {
    expect(showSavedPreferenceRetrieval("collecting", "consent", "consent", true)).toBe(false);
    expect(showSavedPreferenceRetrieval("collecting", "consent", null, false)).toBe(false);
  });
});
