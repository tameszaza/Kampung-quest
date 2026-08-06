import { describe, expect, it } from "vitest";
import { activityBadgeCounts, emptyActivityReadState, markActivityCategoryRead } from "@/features/events/activity-badges";
import type { UserEventActivities } from "@/server/domain/event-coordination";

function activities(): UserEventActivities {
  const card = (runId: string) => ({
    runId,
    imageUrl: null,
    title: runId,
    description: "A community activity",
    lifecycle: "awaiting_responses" as const,
    durationMinutes: 60,
    timeZone: "Asia/Singapore",
    provisionalAvailability: null,
    workingArrangement: null,
    finalArrangement: null,
    recruitment: null,
  });
  return {
    unreadCount: 2,
    groupChatUnread: {},
    notifications: [
      { notificationId: "notification-1", userId: "user-1", runId: "run-1", kind: "change", title: "Changed", body: "Updated", readAt: null, deduplicationKey: "change-1", createdAt: "2026-08-07T10:00:00.000Z" },
      { notificationId: "notification-2", userId: "user-1", runId: "run-2", kind: "group_message", title: "Chat", body: "Message", readAt: null, deduplicationKey: "message-2", createdAt: "2026-08-07T10:01:00.000Z" },
    ],
    suggested: [card("run-3")],
    invitations: [{ invitationId: "invite-1", runId: "run-1", inviterId: "user-2", guestId: "user-1", status: "pending", version: 1, deliveryState: "pending", idempotencyKey: "invite-1", rosterRevision: 1, createdAt: "2026-08-07T10:00:00.000Z", updatedAt: "2026-08-07T10:00:00.000Z", activity: card("run-1") }],
    sentInvitations: [],
    my: {
      awaitingCoordination: [card("run-1")],
      awaitingConfirmation: [card("run-4")],
      upcoming: [],
      completed: [],
      cancelled: [],
    },
  };
}

describe("activity badges", () => {
  it("counts new categories, excludes group chat notifications, and de-duplicates the parent activity count", () => {
    const result = activityBadgeCounts(activities(), emptyActivityReadState());
    expect(result).toMatchObject({ suggested: 1, invited: 1, notifications: 1, activities: 2, my: 2 });
    expect(result.myByGroup["Awaiting coordination"]).toBe(1);
    expect(result.myByGroup["Awaiting confirmation"]).toBe(1);
  });

  it("clears only the category that was opened", () => {
    const state = emptyActivityReadState();
    const next = markActivityCategoryRead(activities(), state, "suggested");
    const result = activityBadgeCounts(activities(), next);
    expect(result.suggested).toBe(0);
    expect(result.invited).toBe(1);
    expect(result.notifications).toBe(1);
    expect(result.my).toBe(2);
  });

  it("keeps other My Activities tabs unread when one tab is opened", () => {
    const state = markActivityCategoryRead(activities(), emptyActivityReadState(), "my", "Awaiting coordination");
    const result = activityBadgeCounts(activities(), state);
    expect(result.myByGroup["Awaiting coordination"]).toBe(0);
    expect(result.myByGroup["Awaiting confirmation"]).toBe(1);
    expect(result.my).toBe(1);
  });
});
