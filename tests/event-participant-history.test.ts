import { describe, expect, it } from "vitest";
import { latestInvitationForUser, latestMembershipForUser } from "@/lib/event-participant-history";

describe("event participant history", () => {
  it("uses a new invitation when the same user is selected after replacement", () => {
    const invitations = [
      { invitationId: "old", guestId: "member-2", status: "replaced" },
      { invitationId: "new", guestId: "member-2", status: "pending" },
    ];

    expect(latestInvitationForUser(invitations, "member-2")).toEqual(invitations[1]);
  });

  it("uses a new membership when the same user rejoins", () => {
    const memberships = [
      { membershipId: "old", userId: "member-2", status: "replaced" },
      { membershipId: "new", userId: "member-2", status: "coordinating" },
    ];

    expect(latestMembershipForUser(memberships, "member-2")).toEqual(memberships[1]);
  });
});
