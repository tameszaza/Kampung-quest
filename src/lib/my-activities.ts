export const activityGroups = [
  "Awaiting coordination",
  "Awaiting confirmation",
  "Upcoming",
  "Completed",
  "Cancelled",
] as const;

export type ActivityGroup = (typeof activityGroups)[number];

export function isActivityGroup(value: string | undefined): value is ActivityGroup {
  return activityGroups.includes(value as ActivityGroup);
}

export function activityTabHref(tab: ActivityGroup) {
  return `/my-quests?tab=${encodeURIComponent(tab)}`;
}
