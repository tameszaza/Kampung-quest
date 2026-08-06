import type { EventQuestView } from "@/server/domain/event-coordination";
import type { QuestRun } from "@/server/domain/schemas";

export function eventMemberPresentation(view: EventQuestView, userId: string) {
  const participant = view.participantProgress.find((candidate) => candidate.userId === userId);
  return {
    displayName: participant?.displayName ?? fallbackMemberName(userId),
    photoUrl: participant?.photoUrl ?? null,
  };
}

export interface QuestReviewPresentation {
  kind: "planning" | "safety";
  badge: string;
  title: string;
  summary: string;
  reasons: string[];
  safetyLabel: string;
  actionLabel: string;
}

export function questReviewPresentation(run: QuestRun): QuestReviewPresentation | null {
  if (run.status !== "human_review") return null;

  const validationReasons = [...new Set(run.validation?.errors.map((error) => error.message) ?? [])];
  if (validationReasons.length > 0) {
    return {
      kind: "planning",
      badge: "Planning changes needed",
      title: `This draft needs ${countLabel(validationReasons.length, "planning change")}`,
      summary: "No invitations were sent. Adjust the request and Senior Quest will look for another combination that fits.",
      reasons: validationReasons,
      safetyLabel: "Not run — fix the planning details first",
      actionLabel: "Adjust request",
    };
  }

  const safetyReasons = [...new Set(run.safety?.conditions ?? [])];
  const concernCount = Math.max(1, safetyReasons.length);
  return {
    kind: "safety",
    badge: "Safety review needed",
    title: `A coordinator needs to check ${countLabel(concernCount, "safety concern")}`,
    summary: "No invitations were sent. You can adjust the request to avoid this concern while the draft remains on hold.",
    reasons: safetyReasons.length > 0 ? safetyReasons : ["The safety reviewer did not provide a specific reason."],
    safetyLabel: run.safety
      ? `${run.safety.status.replace("_", " ")} · ${run.safety.riskLevel} risk`
      : "Review did not complete",
    actionLabel: "Adjust request",
  };
}

function countLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function fallbackMemberName(value: string) {
  return value.replace(/^demo_/, "").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
