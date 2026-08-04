import { describe, expect, it } from "vitest";
import { eventMemberPresentation } from "@/features/events/presentation";
import type { EventQuestView } from "@/server/domain/event-coordination";

describe("event quest presentation", () => {
  it("uses the server-resolved member name and avatar instead of exposing an opaque user id", () => {
    const opaqueId = "ymihwjMUVseH5gPq2shyArk1CEFz61NC";
    const view = {
      participantProgress: [{
        userId: opaqueId,
        displayName: "David Koh",
        photoUrl: "/avatars/david.jpg",
      }],
    } as EventQuestView;

    expect(eventMemberPresentation(view, opaqueId)).toEqual({
      displayName: "David Koh",
      photoUrl: "/avatars/david.jpg",
    });
  });
});
