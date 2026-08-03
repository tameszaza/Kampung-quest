import type { Quest } from "@/types/quest";
import type { QuestRun } from "@/server/domain/schemas";

/**
 * Keep activity visibility decisions date-based instead of relying on labels
 * such as "Tomorrow" or "Aug 8". The same helpers are used by suggestions,
 * invitations, and My Activities so every surface agrees on expiry.
 */
export function isQuestPast(quest: Quest, now = new Date()) {
  return Date.parse(quest.startAt) <= now.getTime();
}

export function isQuestRunPast(run: QuestRun, now = new Date()) {
  const startsAt = run.proposal?.quest.proposedTimeWindow.start;
  return startsAt ? Date.parse(startsAt) <= now.getTime() : false;
}
