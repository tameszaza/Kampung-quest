"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActivityBadges } from "@/components/activity-badge-context";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Tabs } from "@/components/tabs";
import type { EventActivityCard, UserEventActivities } from "@/server/domain/event-coordination";
import { activityGroups, activityTabHref, isActivityGroup, type ActivityGroup } from "@/lib/my-activities";

export function MyQuestsPage({ initialTab }: { initialTab: ActivityGroup }) {
  const router = useRouter();
  const [tab, setTab] = useState<ActivityGroup>(initialTab);
  const readGroup = useRef<ActivityGroup | null>(null);
  const { activities, loading, error, refresh, markCategoryRead } = useActivityBadges();

  useEffect(() => {
    if (!activities || readGroup.current === tab) return;
    readGroup.current = tab;
    markCategoryRead("my", tab);
  }, [activities, markCategoryRead, tab]);

  useEffect(() => {
    function syncTabFromHistory() {
      const value = new URLSearchParams(window.location.search).get("tab") ?? undefined;
      setTab(isActivityGroup(value) ? value : initialTab);
    }
    window.addEventListener("popstate", syncTabFromHistory);
    return () => window.removeEventListener("popstate", syncTabFromHistory);
  }, [initialTab]);

  function selectTab(nextTab: ActivityGroup) {
    setTab(nextTab);
    router.replace(activityTabHref(nextTab), { scroll: false });
  }

  const visible = activities ? groupActivities(activities, tab) : [];
  const tabOptions = activityGroups.map((group) => ({
    label: group,
    count: activities ? groupActivities(activities, group).length : undefined,
    countStyle: "parentheses" as const,
  }));
  return (
    <div className="page-container narrow-page my-activities-ref">
      <PageHeader title="My Activities" />
      <Tabs tabs={tabOptions} active={tab} onChange={(value) => selectTab(value as ActivityGroup)} />
      {error ? <div className="connected-state error" role="alert"><Icon name="shield" />{error}<button type="button" className="text-button" onClick={() => void refresh()}>Try again</button></div> : null}
      {!activities && loading && !error ? <div className="connected-state" role="status"><span className="connected-spinner" />Loading your activities…</div> : null}
      {activities && visible.length === 0 ? <div className="empty-state"><span><Icon name="check" size={34} /></span><h2>Nothing here yet</h2><p>{emptyCopy(tab)}</p></div> : null}
      <section className="joined-list" aria-label={tab}>
        {visible.map((activity) => <JoinedEventCard activity={activity} group={tab} key={activity.runId} />)}
      </section>
    </div>
  );
}

function JoinedEventCard({ activity, group }: { activity: EventActivityCard; group: ActivityGroup }) {
  const window = activity.finalArrangement ?? activity.provisionalAvailability;
  return <Link className="joined-card event-joined-card" href={`/quests/${activity.runId}?from=my-activities&tab=${encodeURIComponent(group)}`}>
    <div className="joined-image"><Image src={activity.imageUrl ?? "/assets/quest-placeholder.svg"} alt="" fill sizes="(max-width: 767px) 100vw, 280px" /><span className="image-badge">{group}</span></div>
    <div className="joined-body">
      <h2>{activity.title}</h2>
      <p>{activity.description}</p>
      <div className="meta-row"><Icon name="calendar" size={19} /><span><strong>{activity.finalArrangement ? "Confirmed schedule" : "Availability being coordinated"}</strong><small>{window ? new Date(window.start).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "No time proposed yet"}{activity.finalArrangement ? ` · ${activity.finalArrangement.venueName}` : ""}</small></span></div>
      <div className="joined-footer"><span>{actionCopy(group)}</span><Icon name="chevron" size={19} /></div>
    </div>
  </Link>;
}

function groupActivities(activities: UserEventActivities, group: ActivityGroup) {
  if (group === "Awaiting coordination") return activities.my.awaitingCoordination;
  if (group === "Awaiting confirmation") return activities.my.awaitingConfirmation;
  if (group === "Upcoming") return activities.my.upcoming;
  if (group === "Completed") return activities.my.completed;
  return activities.my.cancelled;
}

function actionCopy(group: ActivityGroup) {
  if (group === "Awaiting coordination") return "Share requirements and coordinate";
  if (group === "Awaiting confirmation") return "Review the proposed arrangement";
  if (group === "Upcoming") return "View confirmed details";
  return "View activity history";
}

function emptyCopy(group: ActivityGroup) {
  if (group === "Awaiting coordination") return "Accepted invitations and groups you organize will appear here.";
  if (group === "Awaiting confirmation") return "Arrangements that need confirmation will appear here.";
  if (group === "Upcoming") return "Fully confirmed activities will appear here.";
  return `You have no ${group.toLowerCase()} activities.`;
}
