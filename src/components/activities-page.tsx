"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useActivityBadges } from "@/components/activity-badge-context";
import { useAppState } from "@/components/app-state";
import { Icon } from "@/components/icons";
import { ActivityNotifications } from "@/components/activity-notifications";
import { PageHeader } from "@/components/page-header";
import { Tabs } from "@/components/tabs";
import { useUser } from "@/components/user-context";
import { respondToEventInvitation } from "@/features/events/client";
import type {
  EventActivityCard,
  EventInvitationView,
} from "@/server/domain/event-coordination";

export function ActivitiesPage({ initialTab = "Suggested" }: { initialTab?: "Suggested" | "Invited" | "Notifications" }) {
  const [tab, setTab] = useState<"Suggested" | "Invited" | "Notifications">(initialTab);
  const [inviteTab, setInviteTab] = useState<"Received" | "Sent">("Received");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const readTab = useRef<string | null>(null);
  const { user } = useUser();
  const { showToast } = useAppState();
  const { activities, counts, loading, error: activityError, refresh, markCategoryRead } = useActivityBadges();

  useEffect(() => {
    if (!activities || readTab.current === tab) return;
    readTab.current = tab;
    if (tab === "Suggested") markCategoryRead("suggested");
    if (tab === "Invited") markCategoryRead("invited");
    if (tab === "Notifications") markCategoryRead("notifications");
  }, [activities, markCategoryRead, tab]);

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
      await refresh();
      if (response === "accept") showToast("Invitation accepted. This activity is now in My Activities.");
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
  const displayError = error || activityError;

  return (
    <div className="page-container">
      <PageHeader title="Activities" />
      <Tabs
        tabs={[
          { label: "Suggested", count: counts.suggested },
          { label: "Invited", count: counts.invited },
          { label: "Notifications", count: counts.notifications },
        ]}
        active={tab}
        onChange={(value) => setTab(value as "Suggested" | "Invited" | "Notifications")}
      />
      {displayError ? <div className="connected-state error" role="alert"><Icon name="shield" />{displayError}<button className="text-button" type="button" onClick={() => void refresh()}>Try again</button></div> : null}
      {!activities && loading && !displayError ? <div className="connected-state" role="status"><span className="connected-spinner" />Loading activities…</div> : null}
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
            {received.map((invitation) => <EventInvitationCard
              invitation={invitation}
              busy={busyId === invitation.invitationId}
              onRespond={respond}
              key={invitation.invitationId}
            />)}
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
      {activities && tab === "Notifications" ? <ActivityNotifications activities={activities} /> : null}
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
      <EventActivityCardImage activity={activity} status={status} />
      <EventActivityCardBody
        activity={activity}
        action={action}
        invitationSummary={invitationSummary}
        window={window}
        matchedGroup={matchedGroup}
      />
    </Link>
  </article>;
}

function EventInvitationCard({
  invitation,
  busy,
  onRespond,
}: {
  invitation: EventInvitationView;
  busy: boolean;
  onRespond: (invitation: EventInvitationView, response: "accept" | "decline") => Promise<void>;
}) {
  const { activity } = invitation;
  const window = activity.finalArrangement ?? activity.provisionalAvailability;
  const status = activityStatusLabel(activity.lifecycle);

  return <article className="quest-card event-activity-card event-invite-card">
    <EventActivityCardImage activity={activity} status={status} />
    <EventActivityCardBody
      activity={activity}
      window={window}
      invitationSummary="New invitation"
      titleLink
      footer={<>
        <p className="event-invitation-note">Accept to join the group. The final time and venue will be confirmed together.</p>
        <div className="event-invite-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void onRespond(invitation, "decline")}>Decline</button>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void onRespond(invitation, "accept")}>{busy ? "Saving…" : "Accept & coordinate"}</button>
        </div>
      </>}
    />
  </article>;
}

function EventActivityCardImage({ activity, status }: { activity: EventActivityCard; status: string }) {
  return <div className="event-activity-card-image">
    <Image src={activity.imageUrl ?? "/assets/quest-placeholder.svg"} alt="" fill sizes="(max-width: 767px) 34vw, 220px" />
    <span className="image-badge event-activity-status"><Icon name={activity.lifecycle === "scheduled" ? "check" : "people"} size={14} /> {status}</span>
  </div>;
}

function EventActivityCardBody({
  activity,
  action,
  invitationSummary,
  titleLink = false,
  window,
  matchedGroup,
  footer,
}: {
  activity: EventActivityCard;
  action?: string;
  invitationSummary?: string;
  titleLink?: boolean;
  window: { start: string; end: string } | null;
  matchedGroup?: string | null;
  footer?: ReactNode;
}) {
  return <div className="quest-card-body event-activity-card-body">
    {invitationSummary ? <span className="event-invitation-summary"><Icon name="invite" size={14} />{invitationSummary}</span> : null}
    <h2>{titleLink ? <Link className="event-activity-title-link" href={`/quests/${activity.runId}`}>{activity.title}</Link> : activity.title}</h2>
    <p className="event-activity-description">{activity.description}</p>
    <div className="event-activity-facts" aria-label="Activity summary">
      <span><Icon name="calendar" size={16} />{window ? formatCompactWindow(window.start, window.end) : "Time to coordinate"}</span>
      {matchedGroup ? <span><Icon name="people" size={16} />{matchedGroup}</span> : null}
    </div>
    {footer}
    {action ? <span className="primary-button event-card-action"><span>{action}</span><Icon name="chevron" size={17} /></span> : null}
  </div>;
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

function EmptyActivities({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><span><Icon name="quests" size={34} /></span><h2>{title}</h2><p>{body}</p><Link className="primary-button" href="/messages?assistant=1">Talk to Senior Quest</Link></div>;
}

function formatCompactWindow(start: string, end: string) {
  const from = new Date(start);
  const until = new Date(end);
  return `${from.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${from.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}
