import { describe, expect, it } from "vitest";
import { questParticipantStatus } from "@/lib/quest-participant-status";

describe("quest participant status", () => {
  it("shows accepted participants as joining", () => {
    expect(questParticipantStatus("member-2", "member-1", "accepted")).toEqual({ key: "joining", label: "Joining" });
  });

  it("shows the viewer's pending invitation as invited", () => {
    expect(questParticipantStatus("member-1", "member-1", "pending")).toEqual({ key: "invited", label: "Invited" });
  });

  it("shows other pending participants as pending", () => {
    expect(questParticipantStatus("member-2", "member-1", "pending")).toEqual({ key: "pending", label: "Pending" });
  });

  it("does not call an unprepared invitation invited", () => {
    expect(questParticipantStatus("member-1", "member-1")).toEqual({ key: "pending", label: "Pending" });
  });
});
