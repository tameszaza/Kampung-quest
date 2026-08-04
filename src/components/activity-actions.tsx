"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";

/** Quest decisions are server-owned. This legacy card action only opens the
 * authoritative detail/formation view; it never records acceptance locally. */
export function ActivityActions({ activityId, acceptOnly = false, initialDecision, onDecision }: {
  activityId: string;
  acceptOnly?: boolean;
  initialDecision?: "accepted" | "declined";
  onDecision?: (decision: "accepted" | "declined") => void;
}) {
  if (initialDecision) {
    return <div className={`decision-message ${initialDecision}`}><Icon name={initialDecision === "accepted" ? "check" : "close"} size={19} />{initialDecision === "accepted" ? "Activity accepted" : "Activity rejected"}</div>;
  }
  if (onDecision) {
    return <div className="activity-actions">
      {!acceptOnly ? <button className="secondary-button" type="button" onClick={() => onDecision("declined")}>Reject</button> : null}
      <button className="primary-button" type="button" onClick={() => onDecision("accepted")}>Accept</button>
    </div>;
  }
  return <div className="activity-actions accept-only"><Link className="primary-button" href={`/quests/${activityId}`}>Review activity <Icon name="chevron" size={18} /></Link></div>;
}
