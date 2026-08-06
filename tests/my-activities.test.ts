import { describe, expect, it } from "vitest";
import { activityGroups, activityTabHref, isActivityGroup } from "@/lib/my-activities";

describe("my activity navigation", () => {
  it("accepts the Completed tab as a direct destination", () => {
    expect(isActivityGroup("Completed")).toBe(true);
    expect(activityTabHref("Completed")).toBe("/my-quests?tab=Completed");
  });

  it("rejects unknown tabs and preserves the supported tab order", () => {
    expect(isActivityGroup("Done")).toBe(false);
    expect(activityGroups).toEqual([
      "Awaiting coordination",
      "Awaiting confirmation",
      "Upcoming",
      "Completed",
      "Cancelled",
    ]);
  });
});
