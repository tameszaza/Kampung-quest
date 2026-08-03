"use client";

import { useAppState } from "@/components/app-state";
import { Icon } from "@/components/icons";

export function ActivityActions({ activityId }: { activityId: string }) {
  const { activityDecisions, decideActivity } = useAppState();
  const decision = activityDecisions[activityId];

  if (decision) {
    return <div className={`decision-message ${decision}`}><Icon name={decision === "accepted" ? "check" : "close"} size={19} />{decision === "accepted" ? "Activity accepted" : "Activity rejected"}</div>;
  }

  return <div className="activity-actions">
    <button className="secondary-button" type="button" onClick={() => decideActivity(activityId, "declined")}>Reject</button>
    <button className="primary-button" type="button" onClick={() => decideActivity(activityId, "accepted")}>Accept</button>
  </div>;
}
