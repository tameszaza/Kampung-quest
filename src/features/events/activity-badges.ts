import type { EventActivityCard, UserEventActivities } from "@/server/domain/event-coordination";
import { activityGroups, type ActivityGroup } from "@/lib/my-activities";

export type ActivityReadState = {
  suggested: string[];
  invited: string[];
  notifications: string[];
  my: Record<ActivityGroup, string[]>;
};

export type ActivityBadgeCounts = {
  activities: number;
  suggested: number;
  invited: number;
  notifications: number;
  my: number;
  myByGroup: Record<ActivityGroup, number>;
};

const STORAGE_PREFIX = "senior-quest-activity-badges-v2:";

export function emptyActivityReadState(): ActivityReadState {
  return {
    suggested: [],
    invited: [],
    notifications: [],
    my: emptyMyReadState(),
  };
}

export function loadActivityReadState(userId: string): ActivityReadState {
  if (typeof window === "undefined") return emptyActivityReadState();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`) ?? "null") as Partial<ActivityReadState> | null;
    if (!parsed) return emptyActivityReadState();
    const my = emptyMyReadState();
    for (const group of activityGroups) my[group] = unique(parsed.my?.[group]);
    return {
      suggested: unique(parsed.suggested),
      invited: unique(parsed.invited),
      notifications: unique(parsed.notifications),
      my,
    };
  } catch {
    return emptyActivityReadState();
  }
}

export function saveActivityReadState(userId: string, state: ActivityReadState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(state));
  } catch {
    // A full or blocked local store should not prevent activity navigation.
  }
}

export function activityBadgeCounts(activities: UserEventActivities, readState: ActivityReadState): ActivityBadgeCounts {
  const readSuggested = new Set(readState.suggested);
  const readInvited = new Set(readState.invited);
  const readNotifications = new Set(readState.notifications);
  const suggested = activities.suggested.filter((activity) => !readSuggested.has(activity.runId));
  const invited = activities.invitations.filter((invitation) => !readInvited.has(invitation.invitationId));
  const notifications = activities.notifications.filter((notification) => notification.kind !== "group_message" && notification.readAt === null && !readNotifications.has(notification.notificationId));
  const myByGroup = {} as Record<ActivityGroup, number>;
  for (const group of activityGroups) {
    const read = new Set(readState.my[group]);
    myByGroup[group] = groupActivities(activities, group).filter((activity) => !read.has(activity.runId)).length;
  }
  const myIds = new Set<string>();
  for (const group of activityGroups) {
    for (const activity of groupActivities(activities, group)) {
      if (!readState.my[group].includes(activity.runId)) myIds.add(activity.runId);
    }
  }
  // The shell count represents new activity records. One notification and one
  // invitation for the same run should not make the parent badge read "2".
  const activityIds = new Set<string>();
  for (const activity of suggested) activityIds.add(activity.runId);
  for (const invitation of invited) activityIds.add(invitation.runId);
  for (const notification of notifications) activityIds.add(notification.runId);

  return {
    activities: activityIds.size,
    suggested: suggested.length,
    invited: invited.length,
    notifications: notifications.length,
    my: myIds.size,
    myByGroup,
  };
}

export function markActivityCategoryRead(
  activities: UserEventActivities,
  state: ActivityReadState,
  category: "suggested" | "invited" | "notifications" | "my",
  group?: ActivityGroup,
): ActivityReadState {
  const next = cloneReadState(state);
  if (category === "suggested") next.suggested = merge(next.suggested, activities.suggested.map((activity) => activity.runId));
  if (category === "invited") next.invited = merge(next.invited, activities.invitations.map((invitation) => invitation.invitationId));
  if (category === "notifications") next.notifications = merge(next.notifications, activities.notifications.filter((notification) => notification.kind !== "group_message").map((notification) => notification.notificationId));
  if (category === "my") {
    for (const activityGroup of group ? [group] : activityGroups) {
      next.my[activityGroup] = merge(next.my[activityGroup], groupActivities(activities, activityGroup).map((activity) => activity.runId));
    }
  }
  return next;
}

function groupActivities(activities: UserEventActivities, group: ActivityGroup): EventActivityCard[] {
  if (group === "Awaiting coordination") return activities.my.awaitingCoordination;
  if (group === "Awaiting confirmation") return activities.my.awaitingConfirmation;
  if (group === "Upcoming") return activities.my.upcoming;
  if (group === "Completed") return activities.my.completed;
  return activities.my.cancelled;
}

function cloneReadState(state: ActivityReadState): ActivityReadState {
  return {
    suggested: [...state.suggested],
    invited: [...state.invited],
    notifications: [...state.notifications],
    my: Object.fromEntries(activityGroups.map((group) => [group, [...state.my[group]]])) as unknown as Record<ActivityGroup, string[]>,
  };
}

function emptyMyReadState(): Record<ActivityGroup, string[]> {
  const my = {} as Record<ActivityGroup, string[]>;
  for (const group of activityGroups) my[group] = [];
  return my;
}

function merge(current: string[], additions: string[]) {
  return unique([...current, ...additions]);
}

function unique(values: unknown): string[] {
  return Array.isArray(values) ? [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))] : [];
}
