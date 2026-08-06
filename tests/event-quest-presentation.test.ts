import { describe, expect, it } from "vitest";
import { eventMemberPresentation, questReviewPresentation } from "@/features/events/presentation";
import type { EventQuestView } from "@/server/domain/event-coordination";
import type { QuestRun } from "@/server/domain/schemas";

describe("event quest presentation", () => {
  it("uses the server-resolved member name and avatar instead of exposing an opaque user id", () => {
    const opaqueId = "ymihwjMUVseH5gPq2shyArk1CEFz61NC";
    const view = {
      participantProgress: [{
        userId: opaqueId,
        displayName: "David Koh",
        photoUrl: "/avatars/david.jpg",
      }],
    } as EventQuestView;

    expect(eventMemberPresentation(view, opaqueId)).toEqual({
      displayName: "David Koh",
      photoUrl: "/avatars/david.jpg",
    });
  });
});

describe("quest review presentation", () => {
  it("presents constraint failures as actionable planning changes rather than a vague safety review", () => {
    const review = questReviewPresentation({
      status: "human_review",
      validation: {
        valid: false,
        errors: [
          { field: "availability", message: "Proposed time is outside the participant's availability." },
          { field: "accessibility", message: "A stair-free venue is required." },
        ],
      },
      safety: null,
    } as unknown as QuestRun);

    expect(review).toMatchObject({
      badge: "Planning changes needed",
      title: "This draft needs 2 planning changes",
      actionLabel: "Adjust request",
      safetyLabel: "Not run — fix the planning details first",
    });
    expect(review?.reasons).toEqual([
      "Proposed time is outside the participant's availability.",
      "A stair-free venue is required.",
    ]);
  });

  it("shows the safety review's concrete reasons", () => {
    const review = questReviewPresentation({
      status: "human_review",
      validation: { valid: true, errors: [] },
      safety: {
        status: "human_review",
        riskLevel: "medium",
        conditions: ["The plan includes a participant-to-participant money transfer."],
        requiresHumanReview: true,
      },
    } as unknown as QuestRun);

    expect(review).toMatchObject({
      badge: "Safety review needed",
      title: "A coordinator needs to check 1 safety concern",
      actionLabel: "Adjust request",
      reasons: ["The plan includes a participant-to-participant money transfer."],
    });
  });
});
