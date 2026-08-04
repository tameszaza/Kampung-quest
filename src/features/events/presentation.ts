import type { EventQuestView } from "@/server/domain/event-coordination";

export function eventMemberPresentation(view: EventQuestView, userId: string) {
  const participant = view.participantProgress.find((candidate) => candidate.userId === userId);
  return {
    displayName: participant?.displayName ?? fallbackMemberName(userId),
    photoUrl: participant?.photoUrl ?? null,
  };
}

function fallbackMemberName(value: string) {
  return value.replace(/^demo_/, "").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
