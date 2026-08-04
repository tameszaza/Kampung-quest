"use client";

import { useAppState } from "@/components/app-state";
import { Icon } from "@/components/icons";
import { useState } from "react";

export function ActivityActions({ activityId, acceptOnly = false, initialDecision, onDecision }: {
  activityId: string;
  acceptOnly?: boolean;
  initialDecision?: "accepted" | "declined";
  onDecision?: (decision: "accepted" | "declined") => void;
}) {
  const { activityDecisions, decideActivity } = useAppState();
  const decision = activityDecisions[activityId] ?? initialDecision;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (decision) {
    return <div className={`decision-message ${decision}`}><Icon name={decision === "accepted" ? "check" : "close"} size={19} />{decision === "accepted" ? "Activity accepted" : "Activity rejected"}</div>;
  }

  const choose = async (nextDecision: "accepted" | "declined") => {
    if (busy) return;
    if (!activityId.startsWith("quest_")) {
      decideActivity(activityId, nextDecision);
      onDecision?.(nextDecision);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/quests/${encodeURIComponent(activityId)}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: nextDecision === "accepted" ? "participant_accepted" : "participant_declined" }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Your response could not be saved");
      decideActivity(activityId, nextDecision);
      onDecision?.(nextDecision);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your response could not be saved");
    } finally {
      setBusy(false);
    }
  };

  return <div className={`activity-actions${acceptOnly ? " accept-only" : ""}`}>
    {!acceptOnly ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void choose("declined")}>Reject</button> : null}
    <button className="primary-button" type="button" disabled={busy} onClick={() => void choose("accepted")}>{busy ? "Saving…" : "Accept"}</button>
    {error ? <small className="activity-action-error" role="alert">{error}</small> : null}
  </div>;
}
