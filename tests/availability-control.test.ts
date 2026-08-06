import { describe, expect, it } from "vitest";
import {
  isAvailabilityRangeValid,
  shiftAvailabilityEnd,
  specificAvailabilityWindows,
} from "@/components/assistant-conversation";

describe("specific availability confirmation", () => {
  it("confirms the valid time currently shown without requiring a separate add step", () => {
    const windows = specificAvailabilityWindows(
      [],
      "2026-08-05T11:00",
      "2026-08-05T14:00",
      "Asia/Singapore",
    );

    expect(windows).toEqual([{
      start: "2026-08-05T03:00:00.000Z",
      end: "2026-08-05T06:00:00.000Z",
      timeZone: "Asia/Singapore",
    }]);
  });

  it("does not confirm an invalid range or duplicate an explicitly added window", () => {
    expect(specificAvailabilityWindows([], "2026-08-05T14:00", "2026-08-05T11:00", "Asia/Singapore")).toEqual([]);
    const saved = [{
      start: "2026-08-06T03:00:00.000Z",
      end: "2026-08-06T05:00:00.000Z",
      timeZone: "Asia/Singapore",
    }];
    expect(specificAvailabilityWindows(saved, "2026-08-05T11:00", "2026-08-05T14:00", "Asia/Singapore")).toEqual(saved);
  });

  it("keeps the current duration when the start changes", () => {
    expect(shiftAvailabilityEnd(
      "2026-08-07T11:00",
      "2026-08-07T14:00",
      "2026-08-08T15:30",
    )).toBe("2026-08-08T18:30");
  });

  it("falls back to the default duration when the current range is invalid", () => {
    expect(shiftAvailabilityEnd(
      "2026-08-07T14:00",
      "2026-08-07T11:00",
      "2026-08-08T15:30",
    )).toBe("2026-08-08T18:30");
    expect(isAvailabilityRangeValid("2026-08-08T15:30", "2026-08-08T18:30")).toBe(true);
    expect(isAvailabilityRangeValid("2026-08-08T18:30", "2026-08-08T15:30")).toBe(false);
  });
});
