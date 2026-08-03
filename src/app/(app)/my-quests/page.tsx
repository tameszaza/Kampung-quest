"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Tabs } from "@/components/tabs";
import { listEventActivities } from "@/features/events/client";
import type { EventActivityCard, UserEventActivities } from "@/server/domain/event-coordination";

const groups = ["Awaiting coordination", "Awaiting confirmation", "Upcoming", "Completed", "Cancelled"] as const;
type Group = (typeof groups)[number];

export default function MyQuestsPage() {
  const [tab, setTab] = useState<Group>("Awaiting coordination");
  const [activities, setActivities] = useState<UserEventActivities | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setActivities(await listEventActivities());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "My Activities could not be loaded");
    }
  }, []);
  useEffect(() => {
    let active = true;
    void listEventActivities().then((next) => {
      if (active) setActivities(next);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "My Activities could not be loaded");
    });
    return () => { active = false; };
  }, []);

  const visible = activities ? groupActivities(activities, tab) : [];
  return (
    <div className="page-container narrow-page">
      <PageHeader title="My Activities" />
      <Tabs tabs={[...groups]} active={tab} onChange={(value) => setTab(value as Group)} />
      {error ? <div className="connected-state error" role="alert"><Icon name="shield" />{error}<button type="button" className="text-button" onClick={() => void load()}>Try again</button></div> : null}
      {!activities && !error ? <div className="connected-state" role="status"><span className="connected-spinner" />Loading your activities…</div> : null}
      {activities && visible.length === 0 ? <div className="empty-state"><span><Icon name="check" size={34} /></span><h2>Nothing here yet</h2><p>{emptyCopy(tab)}</p></div> : null}
      <section className="joined-list" aria-label={tab}>
        {visible.map((activity) => <JoinedEventCard activity={activity} group={tab} key={activity.runId} />)}
      </section>
    </div>
  );
}

function JoinedEventCard({ activity, group }: { activity: EventActivityCard; group: Group }) {
  const window = activity.finalArrangement ?? activity.provisionalAvailability;
  return <Link className="joined-card event-joined-card" href={`/quests/${activity.runId}?from=my-activities`}>
    <div className="joined-body">
      <span className="image-badge">{group.toUpperCase()}</span>
      <h2>{activity.title}</h2>
      <p>{activity.description}</p>
      <div className="meta-row"><Icon name="calendar" size={19} /><span>{activity.finalArrangement ? "Confirmed schedule" : "Availability being coordinated"}<small>{window ? new Date(window.start).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "No time proposed yet"}{activity.finalArrangement ? ` · ${activity.finalArrangement.venueName}` : ""}</small></span></div>
      <div className="joined-footer"><span>{actionCopy(group)}</span><Icon name="chevron" size={19} /></div>
    </div>
  </Link>;
}

function groupActivities(activities: UserEventActivities, group: Group) {
  if (group === "Awaiting coordination") return activities.my.awaitingCoordination;
  if (group === "Awaiting confirmation") return activities.my.awaitingConfirmation;
  if (group === "Upcoming") return activities.my.upcoming;
  if (group === "Completed") return activities.my.completed;
  return activities.my.cancelled;
}

function actionCopy(group: Group) {
  if (group === "Awaiting coordination") return "Share requirements and coordinate";
  if (group === "Awaiting confirmation") return "Review the proposed arrangement";
  if (group === "Upcoming") return "View confirmed details";
  return "View activity history";
}

function emptyCopy(group: Group) {
  if (group === "Awaiting coordination") return "Accepted invitations and groups you organize will appear here.";
  if (group === "Awaiting confirmation") return "Arrangements that need confirmation will appear here.";
  if (group === "Upcoming") return "Fully confirmed activities will appear here.";
  return `You have no ${group.toLowerCase()} activities.`;
}
