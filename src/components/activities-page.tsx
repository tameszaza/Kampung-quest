"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { ActivityNotifications } from "@/components/activity-notifications";
import { PageHeader } from "@/components/page-header";
import { Tabs } from "@/components/tabs";
import { useUser } from "@/components/user-context";
import { listEventActivities, markEventNotificationsRead, respondToEventInvitation } from "@/features/events/client";
import type {
  EventActivityCard,
  EventInvitationView,
  UserEventActivities,
} from "@/server/domain/event-coordination";

export function ActivitiesPage({ initialTab = "Suggested" }: { initialTab?: "Suggested" | "Invited" | "Notifications" }) {
  const [tab, setTab] = useState<"Suggested" | "Invited" | "Notifications">(initialTab);
  const [inviteTab, setInviteTab] = useState<"Received" | "Sent">("Received");
  const [activities, setActivities] = useState<UserEventActivities | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const notificationsRead = useRef(false);
  const { user } = useUser();

  const load = useCallback(async () => {
    try {
      setActivities(await listEventActivities());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Activities could not be loaded");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void listEventActivities().then((next) => {
      if (active) setActivities(notificationsRead.current ? { ...next, unreadCount: 0 } : next);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Activities could not be loaded");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void markEventNotificationsRead().then(() => {
      notificationsRead.current = true;
      if (active) {
        setActivities((current) => current ? { ...current, unreadCount: 0 } : current);
        window.dispatchEvent(new Event("event-activities-read"));
      }
    }).catch(() => {
      // Reading notifications is best effort and must not block activities.
    });
    return () => { active = false; };
  }, []);

  async function respond(invitation: EventInvitationView, response: "accept" | "decline") {
    setBusyId(invitation.invitationId);
    setError("");
    try {
      await respondToEventInvitation({
        runId: invitation.runId,
        invitationId: invitation.invitationId,
        response,
        expectedRevision: await currentRevision(invitation.runId),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your invitation response was not saved");
    } finally {
      setBusyId(null);
    }
  }

  async function currentRevision(runId: string) {
    const response = await fetch(`/api/v1/event-quests/${encodeURIComponent(runId)}`, { cache: "no-store" });
    const payload = await response.json() as { revision?: number; error?: string };
    if (!response.ok || !payload.revision) throw new Error(payload.error ?? "Invitation state could not be refreshed");
    return payload.revision;
  }

  const received = activities?.invitations ?? [];
  const sent = activities?.sentInvitations ?? [];
  const sentGroups = groupSentInvitations(sent);
  const suggestedCount = activities?.suggested.length ?? 0;
  const invitedCount = received.length;
  const notificationCount = activities?.unreadCount ?? 0;

  return (
    <div className="page-container">
      <PageHeader title="Activities" />
      <Tabs
        tabs={[
          { label: "Suggested", count: suggestedCount },
          { label: "Invited", count: invitedCount },
          { label: "Notifications", count: notificationCount },
        ]}
        active={tab}
        onChange={(value) => setTab(value as "Suggested" | "Invited" | "Notifications")}
      />
      {error ? <div className="connected-state error" role="alert"><Icon name="shield" />{error}<button className="text-button" type="button" onClick={() => void load()}>Try again</button></div> : null}
      {!activities && !error ? <div className="connected-state" role="status"><span className="connected-spinner" />Loading activities…</div> : null}
      {activities && tab === "Suggested" ? <>
        <p className="matched-copy">Matched for {user.fullName.split(/\s+/)[0]} <span aria-hidden="true">✨</span></p>
        {activities.suggested.length ? (
          <section className="quest-grid" aria-label="Your suggested activities">
            {activities.suggested.map((activity) => <EventActivityCardView activity={activity} key={activity.runId} action="Review group" />)}
          </section>
        ) : <EmptyActivities title="No new suggestions" body="Talk to Senior Quest when you would like help finding another activity." />}
      </> : null}
      {activities && tab === "Invited" ? <>
        <Tabs tabs={["Received", "Sent"]} active={inviteTab} onChange={(value) => setInviteTab(value as "Received" | "Sent")} />
        {inviteTab === "Received" ? (
          received.length ? <section className="invite-list" aria-label="Received activity invitations">
            {received.map((invitation) => <article className="invite-card event-invite-card" key={invitation.invitationId}>
              <span className="result-kicker"><Icon name="invite" size={18} /> New invitation</span>
              <h2>{invitation.activity.title}</h2>
              <p>{invitation.activity.description}</p>
              <AvailabilityLabel activity={invitation.activity} />
              <p className="assistant-note">Accepting means you would like to join coordination. You will confirm the final time and venue later.</p>
              <div className="split-actions">
                <button className="secondary-button" type="button" disabled={busyId === invitation.invitationId} onClick={() => void respond(invitation, "decline")}>Decline</button>
                <button className="primary-button" type="button" disabled={busyId === invitation.invitationId} onClick={() => void respond(invitation, "accept")}>{busyId === invitation.invitationId ? "Saving…" : "Accept & coordinate"}</button>
              </div>
            </article>)}
          </section> : <EmptyActivities title="No pending invitations" body="New invitations that need your response will appear here." />
        ) : sentGroups.length ? <section className="quest-grid sent-invitation-grid" aria-label="Sent activity invitations">
          {sentGroups.map(({ activity, invitations }) => <EventActivityCardView
            activity={activity}
            action="View activity"
            invitationSummary={summarizeSentInvitations(invitations)}
            key={activity.runId}
          />)}
        </section> : <EmptyActivities title="No sent invitations" body="Invitations are created after you confirm a suggested group." />}
      </> : null}
      {activities && tab === "Notifications" ? <ActivityNotifications /> : null}
    </div>
  );
}

export function EventActivityCardView({
  activity,
  action = "View activity",
  invitationSummary,
}: {
  activity: EventActivityCard;
  action?: string;
  invitationSummary?: string;
}) {
  const status = activityStatusLabel(activity.lifecycle);
  const window = activity.finalArrangement ?? activity.provisionalAvailability;
  const matchedGroup = activity.recruitment?.currentApprovedCount
    ? `${activity.recruitment.currentApprovedCount} matched`
    : null;

  return <article className="quest-card event-activity-card">
    <Link className="quest-card-link event-activity-card-link" href={`/quests/${activity.runId}`}>
      <div className="event-activity-card-image">
        <Image src={activity.imageUrl ?? "/assets/quest-placeholder.svg"} alt="" fill sizes="(max-width: 767px) 34vw, 140px" />
        <span className="image-badge event-activity-status"><Icon name={activity.lifecycle === "scheduled" ? "check" : "people"} size={14} /> {status}</span>
      </div>
      <div className="quest-card-body">
        {invitationSummary ? <span className="event-invitation-summary"><Icon name="invite" size={14} />{invitationSummary}</span> : null}
        <h2>{activity.title}</h2>
        <p className="event-activity-description">{activity.description}</p>
        <div className="event-activity-facts" aria-label="Activity summary">
          <span><Icon name="calendar" size={16} />{window ? formatCompactWindow(window.start, window.end) : "Time to coordinate"}</span>
          {matchedGroup ? <span><Icon name="people" size={16} />{matchedGroup}</span> : null}
        </div>
        <span className="primary-button event-card-action"><span>{action}</span><Icon name="chevron" size={17} /></span>
      </div>
    </Link>
  </article>;
}

function groupSentInvitations(invitations: EventInvitationView[]) {
  const groups = new Map<string, { activity: EventActivityCard; invitations: EventInvitationView[] }>();
  for (const invitation of invitations) {
    const existing = groups.get(invitation.activity.runId);
    if (existing) existing.invitations.push(invitation);
    else groups.set(invitation.activity.runId, { activity: invitation.activity, invitations: [invitation] });
  }
  return [...groups.values()];
}

function summarizeSentInvitations(invitations: EventInvitationView[]) {
  const counts = new Map<EventInvitationView["status"], number>();
  for (const invitation of invitations) counts.set(invitation.status, (counts.get(invitation.status) ?? 0) + 1);

  const total = invitations.length;
  if (counts.size === 1) {
    const status = invitations[0].status;
    if (status === "pending") return `${total} invitation${total === 1 ? "" : "s"} sent`;
    return `${total} invitation${total === 1 ? "" : "s"} ${formatInvitationStatus(status)}`;
  }

  return [...counts.entries()]
    .map(([status, count]) => `${count} ${formatInvitationStatus(status)}`)
    .join(" · ");
}

function formatInvitationStatus(status: EventInvitationView["status"]) {
  if (status === "accepted") return "accepted";
  if (status === "declined") return "declined";
  if (status === "expired") return "expired";
  if (status === "withdrawn") return "withdrawn";
  if (status === "replaced") return "replaced";
  if (status === "cancelled") return "cancelled";
  return "pending";
}

function activityStatusLabel(lifecycle: EventActivityCard["lifecycle"]) {
  if (lifecycle === "forming") return "Group ready";
  if (lifecycle === "recruiting") return "Open group";
  if (lifecycle === "awaiting_confirmation") return "Confirm time";
  if (lifecycle === "scheduled") return "Scheduled";
  if (lifecycle === "human_review") return "Needs review";
  return "Activity";
}

function AvailabilityLabel({ activity }: { activity: EventActivityCard }) {
  if (activity.finalArrangement) return <div className="meta-row"><Icon name="calendar" size={19} /><span><strong>Confirmed schedule</strong><small>{formatWindow(activity.finalArrangement.start, activity.finalArrangement.end)} · {activity.finalArrangement.venueName}</small></span></div>;
  const window = activity.provisionalAvailability;
  return <div className="meta-row provisional-time"><Icon name="calendar" size={19} /><span><strong>Available time to coordinate</strong><small>{window ? formatWindow(window.start, window.end) : "To be discussed"} · not scheduled yet</small></span></div>;
}

function EmptyActivities({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><span><Icon name="quests" size={34} /></span><h2>{title}</h2><p>{body}</p><Link className="primary-button" href="/messages?assistant=1">Talk to Senior Quest</Link></div>;
}

function formatWindow(start: string, end: string) {
  const from = new Date(start);
  const until = new Date(end);
  return `${from.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${from.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function formatCompactWindow(start: string, end: string) {
  const from = new Date(start);
  const until = new Date(end);
  return `${from.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${from.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}
