"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
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

  return (
    <div className="page-container">
      <PageHeader title="Activities" />
      {activities?.unreadCount ? <div className="event-unread-banner" role="status"><Icon name="invite" size={18} /><span>{activities.unreadCount} activity update{activities.unreadCount === 1 ? "" : "s"} need your attention.</span><button type="button" className="text-button" onClick={() => void markEventNotificationsRead().then(load)}>Mark read</button></div> : null}
      <Tabs tabs={["Suggested", "Invited", "Notifications"]} active={tab} onChange={(value) => setTab(value as "Suggested" | "Invited" | "Notifications")} />
      {error ? <div className="connected-state error" role="alert"><Icon name="shield" />{error}<button className="text-button" type="button" onClick={() => void load()}>Try again</button></div> : null}
      {!activities && !error ? <div className="connected-state" role="status"><span className="connected-spinner" />Loading activities…</div> : null}
      {activities && tab === "Suggested" ? <>
        <p className="matched-copy">Safely matched for {user.fullName.split(/\s+/)[0]} <span aria-hidden="true">✨</span></p>
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
        ) : sent.length ? <section className="invite-list" aria-label="Sent activity invitations">
          {sent.map((invitation) => <article className="invite-card event-invite-card" key={invitation.invitationId}>
            <span className={`image-badge quest-status-${invitation.status}`}>{invitation.status.replaceAll("_", " ")}</span>
            <h2>{invitation.activity.title}</h2>
            <p>Guest: {friendlyMember(invitation.guestId)}</p>
            <AvailabilityLabel activity={invitation.activity} />
          </article>)}
        </section> : <EmptyActivities title="No sent invitations" body="Invitations are created after you confirm a suggested group." />}
      </> : null}
      {activities && tab === "Notifications" ? (
        <section className="empty-state" aria-live="polite">
          <span><Icon name="invite" size={34} /></span>
          <h2>{activities.unreadCount ? `${activities.unreadCount} updates waiting` : "You are all caught up"}</h2>
          <p>Updates about matches, invitations, and group changes will appear here.</p>
          {activities.unreadCount ? <button className="primary-button" type="button" onClick={() => void markEventNotificationsRead().then(load)}>Mark all as read</button> : null}
        </section>
      ) : null}
    </div>
  );
}

export function EventActivityCardView({ activity, action = "View activity" }: { activity: EventActivityCard; action?: string }) {
  return <article className="quest-card event-activity-card">
    <Link className="quest-card-link" href={`/quests/${activity.runId}`}>
      <div className="quest-card-body">
        <span className="result-kicker"><Icon name={activity.lifecycle === "scheduled" ? "check" : "people"} size={17} /> {activity.lifecycle === "forming" ? "Group ready to review" : activity.lifecycle.replaceAll("_", " ")}</span>
        <h2>{activity.title}</h2>
        <p>{activity.description}</p>
        <AvailabilityLabel activity={activity} />
        <span className="primary-button event-card-action">{action}</span>
      </div>
    </Link>
  </article>;
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

function friendlyMember(value: string) {
  return value.replace(/^demo_/, "").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
