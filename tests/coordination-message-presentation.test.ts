import { describe, expect, it } from "vitest";
import { coordinationMessagePresentation } from "@/features/events/coordination-message-presentation";

describe("coordination message presentation", () => {
  it.each([
    ["arrangement_card" as const, { variant: "activity-card", label: "Arrangement update" }],
    ["change_card" as const, { variant: "activity-card", label: "Activity change" }],
  ])("renders %s as an authoritative card", (kind, expected) => {
    expect(coordinationMessagePresentation(kind)).toEqual(expected);
  });

  it("leaves ordinary chat as an ordinary bubble", () => {
    expect(coordinationMessagePresentation("text")).toEqual({ variant: "default", label: null });
  });
});
