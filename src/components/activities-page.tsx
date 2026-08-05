"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Tabs } from "@/components/tabs";
import { useUser } from "@/components/user-context";
import { hideEventSuggestion, listEventActivities, markEventNotificationsRead, respondToEventInvitation } from "@/features/events/client";
import type {
  EventActivityCard,
  EventInvitationView,
  EventNotificationView,
  UserEventActivities,
} from "@/server/domain/event-coordination";

export function ActivitiesPage({ initialTab = "Suggested" }: { initialTab?: "Suggested" | "Invited" | "Notifications" }) {
  const [tab, setTab] = useState<"Suggested" | "Invited" | "Notifications">(initialTab);
  const [inviteTab, setInviteTab] = useState<"Received" | "Sent">("Received");
  const [activities, setActivities] = useState<UserEventActivities | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
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
      if (active) setActivities(next);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Activities could not be loaded");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const refreshFromShell = (event: Event) => {
      const next = (event as CustomEvent<UserEventActivities>).detail;
      if (next) setActivities(next);
    };
    window.addEventListener("event-activities-refreshed", refreshFromShell);
    return () => window.removeEventListener("event-activities-refreshed", refreshFromShell);
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

  async function hideSuggestion(activity: EventActivityCard) {
    setBusyId(activity.runId);
    setError("");
    setActivities((current) => current ? {
      ...current,
      suggested: current.suggested.filter((candidate) => candidate.runId !== activity.runId),
    } : current);
    try {
      await hideEventSuggestion(activity.runId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This suggestion could not be hidden");
      await load();
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

  return (
    <div className="page-container">
      <PageHeader title="Activities" />
      {activities?.unreadCount ? <div className="event-unread-banner" role="status"><Icon name="invite" size={18} /><span>{activities.unreadCount} activity update{activities.unreadCount === 1 ? "" : "s"} need your attention.</span><button type="button" className="text-button" onClick={() => void markEventNotificationsRead().then(load)}>Mark read</button></div> : null}
      <Tabs tabs={["Suggested", "Invited", "Notifications"]} active={tab} onChange={(value) => setTab(value as "Suggested" | "Invited" | "Notifications")} />
      {error ? <div className="connected-state error" role="alert"><Icon name="shield" />{error}<button className="text-button" type="button" onClick={() => void load()}>Try again</button></div> : null}
      {!activities && !error ? <div className="connected-state" role="status"><span className="connected-spinner" />Loading activities…</div> : null}
      {activities && tab === "Suggested" ? <>
        <p className="matched-copy">Activities available for {user.fullName.split(/\s+/)[0]} <span aria-hidden="true">✨</span></p>
        {activities.suggested.length ? (
          <section className="quest-grid" aria-label="Your suggested activities">
            {activities.suggested.map((activity) => <EventActivityCardView
              activity={activity}
              key={activity.runId}
              action="Review group"
              hiding={busyId === activity.runId}
              onHide={activity.recruitment?.viewerEligibility ? () => void hideSuggestion(activity) : undefined}
            />)}
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
        ) : sent.length ? <section className="invite-list" aria-label="Sent activity invitations">
          {sent.map((invitation) => <article className="invite-card event-invite-card" key={invitation.invitationId}>
            <span className={`image-badge quest-status-${invitation.status}`}>{invitation.status.replaceAll("_", " ")}</span>
            <h2>{invitation.activity.title}</h2>
            <p>Guest: {friendlyMember(invitation.guestId)}</p>
            <AvailabilityLabel activity={invitation.activity} />
          </article>)}
        </section> : <EmptyActivities title="No sent invitations" body="Invitations are created after you confirm a suggested group." />}
      </> : null}
      {activities && tab === "Notifications" ? activities.notifications.length ? (
        <section className="activity-notifications event-notification-list" aria-label="Activity updates" aria-live="polite">
          <div className="event-notification-list-header"><div><h2>Activity updates</h2><p>{activities.unreadCount ? `${activities.unreadCount} unread` : "Everything is up to date"}</p></div>{activities.unreadCount ? <button className="text-button" type="button" onClick={() => void markEventNotificationsRead().then(load)}>Mark all as read</button> : null}</div>
          {activities.notifications.map((notification) => <EventNotificationItem notification={notification} key={notification.notificationId} />)}
        </section>
      ) : (
        <section className="empty-state" aria-live="polite">
          <span><Icon name="bell" size={34} /></span>
          <h2>You are all caught up</h2>
          <p>Invitations, availability updates, and group changes will appear here.</p>
        </section>
      ) : null}
    </div>
  );
}

function EventNotificationItem({ notification }: { notification: EventNotificationView }) {
  return <article className={`activity-notification event-notification${notification.readAt ? "" : " unread"}`}>
    <span className="activity-notification-icon" aria-hidden="true"><Icon name={notificationIcon(notification.kind)} size={21} /></span>
    <div className="activity-notification-content">
      <div className="activity-notification-heading"><h2>{friendlyNotificationTitle(notification)}</h2><time dateTime={notification.createdAt}>{formatNotificationTime(notification.createdAt)}</time></div>
      <p>{notification.body}</p>
      <Link href={`/messages?quest=${encodeURIComponent(notification.runId)}`}>Open coordination <span aria-hidden="true">→</span></Link>
    </div>
  </article>;
}

function friendlyNotificationTitle(notification: EventNotificationView) {
  if (notification.kind !== "invitation_response") return notification.title;
  const actor = notification.title.replace(/ (accepted|declined)$/i, "");
  if (actor.length > 24 && !actor.includes(" ")) {
    return notification.title.toLowerCase().endsWith(" declined") ? "A guest declined" : "A guest accepted";
  }
  return notification.title;
}

function notificationIcon(kind: EventNotificationView["kind"]): "bell" | "calendar" | "invite" | "check" {
  if (kind === "availability_confirmed") return "check";
  if (kind === "availability_shared" || kind === "arrangement" || kind === "change") return "calendar";
  if (kind === "invitation" || kind === "invitation_response") return "invite";
  return "bell";
}

function formatNotificationTime(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, date.toDateString() === new Date().toDateString()
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric" }).format(date);
}

export function EventActivityCardView({ activity, action = "View activity", hiding = false, onHide }: {
  activity: EventActivityCard;
  action?: string;
  hiding?: boolean;
  onHide?: () => void;
}) {
  const requestAction = {
    pending: "Request pending",
    approved: "Added to proposed group",
    rejected: "Request not approved",
  } as const;
  const recruitmentAction = activity.recruitment?.viewerRequestStatus
    ? requestAction[activity.recruitment.viewerRequestStatus]
    : activity.recruitment?.viewerEligibility?.canRequest === false ? "View eligibility details"
    : activity.recruitment?.status === "open" ? "View recruiting quest" : action;
  return <article className="quest-card event-activity-card">
    <Link className="quest-card-link" href={`/quests/${activity.runId}`}>
      <div className="quest-card-body">
        <span className="result-kicker"><Icon name={activity.lifecycle === "scheduled" ? "check" : "people"} size={17} /> {activity.recruitment?.status === "open" ? `Recruiting · ${activity.recruitment.currentApprovedCount} of ${activity.recruitment.targetGroupSize}` : activity.lifecycle === "forming" ? "Group ready to review" : activity.lifecycle.replaceAll("_", " ")}</span>
        <h2>{activity.title}</h2>
        <p>{activity.description}</p>
        <AvailabilityLabel activity={activity} />
        {activity.recruitment ? <div className="meta-row"><Icon name="people" size={19} /><span><strong>{activity.recruitment.currentApprovedCount} approved</strong><small>Minimum {activity.recruitment.minimumGroupSize} · target {activity.recruitment.targetGroupSize} · maximum {activity.recruitment.maximumGroupSize}</small></span></div> : null}
        {activity.recruitment?.viewerEligibility?.canRequest === false ? <div className="recruitment-eligibility-notice"><strong>Not currently eligible</strong><ul>{activity.recruitment.viewerEligibility.notices.map((notice) => <li key={notice}>{notice}</li>)}</ul></div> : null}
        <span className="primary-button event-card-action">{recruitmentAction}</span>
      </div>
    </Link>
    {onHide ? <button className="quiet-button event-hide-suggestion" type="button" disabled={hiding} onClick={onHide}>{hiding ? "Hiding…" : "Hide from Suggested"}</button> : null}
  </article>;
}

function AvailabilityLabel({ activity }: { activity: EventActivityCard }) {
  if (activity.finalArrangement) return <div className="meta-row"><Icon name="calendar" size={19} /><span><strong>Confirmed schedule</strong><small>{formatWindow(activity.finalArrangement.start, activity.finalArrangement.end, activity.timeZone)} · {activity.finalArrangement.venueName}</small></span></div>;
  if (activity.workingArrangement) return <div className="meta-row"><Icon name="calendar" size={19} /><span><strong>Working appointment</strong><small>{formatWindow(activity.workingArrangement.start, activity.workingArrangement.end, activity.timeZone)} · {activity.workingArrangement.venueName} · awaiting confirmation</small></span></div>;
  const window = activity.provisionalAvailability;
  return <div className="meta-row provisional-time"><Icon name="calendar" size={19} /><span><strong>Available time to coordinate</strong><small>{window ? formatWindow(window.start, window.end, activity.timeZone) : "To be discussed"} · not scheduled yet</small></span></div>;
}

function EmptyActivities({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><span><Icon name="quests" size={34} /></span><h2>{title}</h2><p>{body}</p><Link className="primary-button" href="/messages?assistant=1">Talk to Senior Quest</Link></div>;
}

function formatWindow(start: string, end: string, timeZone?: string) {
  const from = new Date(start);
  const until = new Date(end);
  return `${from.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone })}, ${from.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone })}–${until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone })}`;
}

function friendlyMember(value: string) {
  return value.replace(/^demo_/, "").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
