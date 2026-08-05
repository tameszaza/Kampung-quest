import type { EventCoordinationMessage } from "@/server/domain/event-coordination";

export function coordinationMessagePresentation(kind: EventCoordinationMessage["kind"]): {
  variant: "default" | "activity-card";
  label: string | null;
} {
  if (kind === "arrangement_card") return { variant: "activity-card", label: "Arrangement update" };
  if (kind === "change_card") return { variant: "activity-card", label: "Activity change" };
  return { variant: "default", label: null };
}
