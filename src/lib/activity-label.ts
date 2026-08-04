/** Short, user-facing labels used on activity imagery and compact summaries. */
export function activityLabel(value: string): string {
  const normalized = value.toLowerCase().replaceAll("_", " ");
  if (/cook|meal|food/.test(normalized)) return "Indoor activity";
  if (/garden|walk|outdoor|exercise/.test(normalized)) return "Outdoor activity";
  if (/book|conversation|learning|digital/.test(normalized)) return "Community activity";
  return "Community activity";
}

export function participantCountLabel(count: number): string {
  return `${count} participant${count === 1 ? "" : "s"}`;
}

export function activityStatusLabel(value: string): string {
  if (value === "awaiting_responses" || value === "forming") return "New";
  if (value === "awaiting_confirmation") return "Confirm details";
  if (value === "human_review") return "Needs review";
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
