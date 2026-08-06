import { describe, expect, it } from "vitest";
import type { EventActivityCard } from "@/server/domain/event-coordination";
import {
  buildRewardSummary,
  buildRewardSummaryWithTaskEntries,
  POINTS_PER_COMPLETED_ACTIVITY,
  rewardOffers,
} from "@/server/features/reward-service";

function completedActivity(runId: string, title = "Community walk"): EventActivityCard {
  return {
    runId,
    title,
    description: "A completed community activity.",
    lifecycle: "completed",
    durationMinutes: 60,
    timeZone: "Asia/Singapore",
    provisionalAvailability: null,
    workingArrangement: null,
    finalArrangement: null,
    recruitment: null,
  };
}

describe("reward summary", () => {
  it("awards points for each unique completed activity", () => {
    const summary = buildRewardSummary([
      completedActivity("quest_1", "Morning walk"),
      completedActivity("quest_2", "Cooking group"),
      completedActivity("quest_1", "Morning walk"),
    ]);

    expect(summary.balance).toBe(POINTS_PER_COMPLETED_ACTIVITY * 2);
    expect(summary.completedActivityCount).toBe(2);
    expect(summary.earnings).toHaveLength(2);
  });

  it("starts new members at zero points with the offer previews available", () => {
    const summary = buildRewardSummary([]);

    expect(summary.balance).toBe(0);
    expect(summary.earnings).toEqual([]);
    expect(summary.offers.length).toBeGreaterThan(0);
    expect(summary.pointsUntilNextReward).toBe(250);
  });

  it("keeps every collaboration uniquely addressable for its detail page", () => {
    const ids = rewardOffers.map((offer) => offer.offerId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(rewardOffers.every((offer) => offer.title && offer.company && offer.redemptionSteps.length > 0)).toBe(true);
  });

  it("keeps legacy activity rewards while using task rewards as the authority for task events", () => {
    const summary = buildRewardSummaryWithTaskEntries(
      [completedActivity("legacy_quest"), completedActivity("task_quest")],
      [{
        entryId: "reward_1",
        userId: "maria",
        runId: "task_quest",
        taskId: "task_1",
        points: 20,
        kind: "task_award",
        reversesEntryId: null,
        actorId: "admin",
        reason: null,
        createdAt: "2026-08-03T01:00:00.000Z",
        taskTitle: "Prepare fruit",
        eventTitle: "Shared lunch",
        difficulty: "medium",
      }],
      new Set(["task_quest"]),
    );

    expect(summary.balance).toBe(POINTS_PER_COMPLETED_ACTIVITY + 20);
    expect(summary.completedActivityCount).toBe(1);
    expect(summary.approvedTaskCount).toBe(1);
  });
});
