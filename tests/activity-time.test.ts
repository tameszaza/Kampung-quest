import { describe, expect, it } from "vitest";
import { quests } from "@/data/mock-data";
import { isQuestPast, isQuestRunPast } from "@/lib/activity-time";
import type { QuestRun } from "@/server/domain/schemas";

describe("activity visibility dates", () => {
  it("treats an activity as expired at its start time", () => {
    expect(isQuestPast(quests[0], new Date("2026-08-05T11:29:00+08:00"))).toBe(false);
    expect(isQuestPast(quests[0], new Date("2026-08-05T11:30:00+08:00"))).toBe(true);
  });

  it("keeps a generated quest visible until its proposed start", () => {
    const run = {
      proposal: { quest: { proposedTimeWindow: { start: "2026-08-08T07:00:00+08:00" } } },
    } as QuestRun;
    expect(isQuestRunPast(run, new Date("2026-08-08T06:59:00+08:00"))).toBe(false);
    expect(isQuestRunPast(run, new Date("2026-08-08T07:00:00+08:00"))).toBe(true);
  });
});
