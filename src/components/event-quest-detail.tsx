"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { EngineQuestDetail } from "@/components/engine-quest-views";
import { Icon } from "@/components/icons";
import { useUser } from "@/components/user-context";
import {
  confirmEventRoster,
  decideEventArrangement,
  getEventQuest,
  proposeEventArrangement,
  respondToEventInvitation,
  searchEventParticipants,
  suggestEventArrangement,
  transitionEventInvitation,
  transitionEventQuest,
  updateEventRoster,
} from "@/features/events/client";
import type { EventCoordinationState } from "@/server/domain/event-coordination";
import type { ChatContact } from "@/server/identity/types";

export function EventQuestDetail({ runId, showActivityActions = true }: { runId: string; showActivityActions?: boolean }) {
  const [state, setState] = useState<EventCoordinationState | null | undefined>(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void getEventQuest(runId).then((value) => { if (active) setState(value); }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "This activity could not be loaded");
    });
    return () => { active = false; };
  }, [runId]);

  if (state === undefined && !error) return <div className="connected-state" role="status"><span className="connected-spinner" />Loading activity…</div>;
  if (state === null) return <EngineQuestDetail runId={runId} showActivityActions={showActivityActions} />;
  if (!state) return <div className="connected-state error" role="alert"><Icon name="shield" />{error}</div>;
  return <EventQuestWorkspace state={state} onChange={setState} />;
}

function EventQuestWorkspace({ state, onChange }: {
  state: EventCoordinationState;
  onChange: (state: EventCoordinationState) => void;
}) {
  const { user } = useUser();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const organizer = state.initiatorId === user.id;
  const ownInvitation = state.invitations.find((invitation) => invitation.guestId === user.id);
  const ownMembership = state.memberships.find((membership) => membership.userId === user.id);
  const latestArrangement = state.arrangements.at(-1);
  const finalized = [...state.arrangements].reverse().find((arrangement) => arrangement.status === "finalized");
  const proposed = state.proposal.quest.proposedTimeWindow;
  const participants = participantRoster(state);
  const targetGroupSize = state.targetGroupSize ?? state.proposal.quest.groupSize;

  async function act(label: string, action: () => Promise<EventCoordinationState>) {
    setBusy(label);
    setError("");
    try { onChange(await action()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That change could not be saved"); }
    finally { setBusy(""); }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("search");
    try { setContacts(await searchEventParticipants(state.runId, query)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "People could not be searched"); }
    finally { setBusy(""); }
  }

  async function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await act("arrangement", () => proposeEventArrangement({
      runId: state.runId,
      start: new Date(String(data.get("start"))).toISOString(),
      end: new Date(String(data.get("end"))).toISOString(),
      venueName: String(data.get("venueName")),
      venueAddress: String(data.get("venueAddress") || "") || null,
      expectedRevision: state.revision,
    }));
  }

  const schedule = finalized
    ? formatWindow(finalized.start, finalized.end)
    : proposed ? formatWindow(proposed.start, proposed.end) : "No availability window proposed";

  return <div className="detail-page engine-detail-page event-workspace">
    <div className="detail-header-wrap"><header className="page-header"><Link className="icon-button" href="/quests" aria-label="Back to activities"><Icon name="back" /></Link><h1>Activity Details</h1><span /></header></div>
    <div className="detail-layout">
      <div className="event-detail-hero"><span className={`result-kicker quest-status-${state.lifecycle}`}><Icon name={state.lifecycle === "scheduled" ? "check" : "people"} size={18} /> {friendlyStatus(state.lifecycle)}</span><h1>{state.proposal.quest.title}</h1><p>{state.proposal.quest.description}</p></div>
      <article className="detail-content">
        {error ? <div className="form-alert" role="alert">{error}</div> : null}
        <div className="detail-facts">
          <div className="detail-fact"><Icon name="calendar" /><span><small>{finalized ? "Confirmed date and time" : "Provisional availability"}</small><strong>{schedule}</strong>{!finalized ? <em>Not scheduled yet</em> : null}</span></div>
          <div className="detail-fact"><Icon name="clock" /><span><small>Duration</small><strong>About {state.proposal.quest.durationMinutes} minutes</strong></span></div>
          <div className="detail-fact"><Icon name="pin" /><span><small>Venue</small><strong>{finalized?.venueName ?? latestArrangement?.venueName ?? "To be coordinated"}</strong></span></div>
          <div className="detail-fact"><Icon name="people" /><span><small>Group</small><strong>{state.lifecycle === "forming" ? `${state.roster.length} of ${targetGroupSize} selected` : `${participants.length} people`}</strong></span></div>
        </div>

        <section className="event-panel participant-summary">
          <span className="section-kicker">Everyone has a role</span>
          <h2>{participants.length} participants</h2>
          <div className="event-roster">{participants.map((member) => {
            const invitation = state.invitations.find((item) => item.guestId === member.userId);
            const membership = state.memberships.find((item) => item.userId === member.userId);
            const status = membership?.status ?? invitation?.status ?? (member.source === "recommended" ? "suggested" : "pending");
            return <div key={member.userId}>
              <span className="member-initial">{friendlyMember(member.userId).slice(0, 1)}</span>
              <p><strong>{member.userId === user.id ? "You" : friendlyMember(member.userId)}</strong><small>{member.proposedRole.replaceAll("_", " ")}</small></p>
              <span className={`participant-status participant-status-${status}`}>{status.replaceAll("_", " ")}</span>
            </div>;
          })}</div>
        </section>

        {organizer && state.lifecycle === "forming" ? <section className="event-panel">
          <span className="section-kicker">Step 1 · Review your group</span>
          <h2>{state.roster.length} of {targetGroupSize} people selected</h2>
          <p>Change the guest list before any invitations are sent. Every change is checked against availability, consent, group limits, and safety rules.</p>
          <div className="event-roster">{state.roster.map((member) => <div key={member.userId}><span className="member-initial">{friendlyMember(member.userId).slice(0, 1)}</span><p><strong>{member.userId === user.id ? "You" : friendlyMember(member.userId)}</strong><small>{member.source === "recommended" ? "Recommended match" : member.source === "manual" ? "Selected by you" : "Organizer"} · {member.explanation.join(" · ")}</small></p>{member.source !== "initiator" ? <button type="button" className="quiet-button" disabled={Boolean(busy)} onClick={() => void act(`remove-${member.userId}`, () => updateEventRoster({ runId: state.runId, action: "remove", userId: member.userId, expectedRevision: state.revision }))}>Remove</button> : null}</div>)}</div>
          {!state.rosterValidation.valid ? <ul className="validation-errors">{state.rosterValidation.errors.map((item) => <li key={`${item.field}-${item.message}`}>{item.message}</li>)}</ul> : null}
          <form className="event-person-search" onSubmit={search}><label><span>Invite people you know</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search an existing member" /></label><button className="secondary-button" disabled={busy === "search"}>{busy === "search" ? "Searching…" : "Search"}</button></form>
          {contacts.length ? <div className="contact-picker event-contact-results">{contacts.map((contact) => <button type="button" key={contact.id} disabled={Boolean(busy)} onClick={() => void act(`add-${contact.id}`, () => updateEventRoster({ runId: state.runId, action: "add", userId: contact.id, expectedRevision: state.revision }))}><span className="member-initial">{contact.fullName.slice(0, 1)}</span><span><strong>{contact.fullName}</strong><small>{contact.username ? `@${contact.username}` : "Community member"}</small></span><b>+</b></button>)}</div> : null}
          <button className="primary-button event-confirm-roster" type="button" disabled={Boolean(busy) || !state.rosterValidation.valid} onClick={() => void act("confirm-roster", () => confirmEventRoster(state.runId, state.revision))}>{busy === "confirm-roster" ? "Preparing invitations…" : "Confirm group & send invitations"}</button>
        </section> : null}

        {ownInvitation?.status === "pending" ? <section className="event-panel invitation-decision-panel"><span className="section-kicker">Invitation</span><h2>Would you like to join coordination?</h2><p>Accepting does not confirm this provisional time. Everyone will confirm the final arrangement later.</p><div className="split-actions"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void act("decline", () => respondToEventInvitation({ runId: state.runId, invitationId: ownInvitation.invitationId, response: "decline", expectedRevision: state.revision }))}>Decline</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => void act("accept", () => respondToEventInvitation({ runId: state.runId, invitationId: ownInvitation.invitationId, response: "accept", expectedRevision: state.revision }))}>Accept & coordinate</button></div></section> : null}

        {organizer && state.lifecycle !== "forming" && state.invitations.some((invitation) => ["pending", "accepted"].includes(invitation.status)) ? <section className="event-panel"><span className="section-kicker">Invitation status</span><h2>Current guest responses</h2><div className="event-roster">{state.invitations.filter((invitation) => ["pending", "accepted"].includes(invitation.status)).map((invitation) => <div key={invitation.invitationId}><span className="member-initial">{friendlyMember(invitation.guestId).slice(0, 1)}</span><p><strong>{friendlyMember(invitation.guestId)}</strong><small>{invitation.status}</small></p><button type="button" className="quiet-button" disabled={Boolean(busy)} onClick={() => void act(`replace-${invitation.invitationId}`, () => transitionEventInvitation({ runId: state.runId, invitationId: invitation.invitationId, action: "replace", expectedRevision: state.revision }))}>Replace</button></div>)}</div><p className="assistant-note">Replacing preserves the invitation history and returns the quest to group selection. Choose and validate the new guest before sending another invitation.</p></section> : null}

        {ownMembership ? <section className="event-panel coordination-entry"><span className="section-kicker">Private coordination</span><h2>Tell the coordinator what you need</h2><p>Share availability, accessibility, travel, dietary, environmental, or venue requirements privately. Other participants cannot see this conversation.</p><Link className="primary-button" href={`/messages?quest=${encodeURIComponent(state.runId)}`}>Open coordination chat</Link></section> : null}

        {organizer && ownMembership && ["awaiting_responses", "coordinating", "scheduled"].includes(state.lifecycle) && (!latestArrangement || ["finalized", "rejected", "superseded"].includes(latestArrangement.status)) ? <section className="event-panel"><span className="section-kicker">Step 2 · Propose an arrangement</span><h2>Time and public venue</h2><p>Let the coordinator find the earliest overlap from everyone’s confirmed availability, or enter an alternative for validation. Participants will confirm after you approve it.</p><button className="secondary-button suggest-arrangement-button" type="button" disabled={Boolean(busy)} onClick={() => void act("suggest-arrangement", () => suggestEventArrangement(state.runId, state.revision))}>{busy === "suggest-arrangement" ? "Comparing availability…" : "Suggest best compatible arrangement"}</button><form className="arrangement-form" onSubmit={propose}><label><span>Start</span><input name="start" type="datetime-local" required defaultValue={localDateTime(proposed?.start)} /></label><label><span>End</span><input name="end" type="datetime-local" required defaultValue={localDateTime(proposed?.end)} /></label><label><span>Public venue</span><input name="venueName" required placeholder="For example, Sunny Community Kitchen" /></label><label><span>Public directions (optional)</span><input name="venueAddress" placeholder="Do not enter a participant's home address" /></label><button className="primary-button" disabled={Boolean(busy)}>{busy === "arrangement" ? "Checking…" : "Check & propose arrangement"}</button></form></section> : null}

        {organizer && latestArrangement?.status === "proposed" ? <section className="event-panel arrangement-review"><span className="section-kicker">Organizer approval</span><h2>Review the proposed arrangement</h2><ArrangementSummary state={state} /><div className="split-actions"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void act("reject-arrangement", () => decideEventArrangement({ runId: state.runId, arrangementId: latestArrangement.arrangementId, action: "reject", expectedRevision: state.revision }))}>Adjust it</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => void act("approve-arrangement", () => decideEventArrangement({ runId: state.runId, arrangementId: latestArrangement.arrangementId, action: "approve", expectedRevision: state.revision }))}>Approve & ask everyone</button></div></section> : null}

        {!organizer && ownMembership && latestArrangement?.status === "awaiting_participant_confirmation" && latestArrangement.confirmations.find((item) => item.userId === user.id)?.status === "pending" ? <section className="event-panel arrangement-review"><span className="section-kicker">Your confirmation</span><h2>Does this final arrangement work for you?</h2><ArrangementSummary state={state} /><div className="split-actions"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void act("reject-arrangement", () => decideEventArrangement({ runId: state.runId, arrangementId: latestArrangement.arrangementId, action: "reject", expectedRevision: state.revision }))}>I can’t make this</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => void act("confirm-arrangement", () => decideEventArrangement({ runId: state.runId, arrangementId: latestArrangement.arrangementId, action: "confirm", expectedRevision: state.revision }))}>Confirm this arrangement</button></div></section> : null}

        {state.lifecycle === "scheduled" && finalized ? <section className="event-panel scheduled-panel"><span className="result-kicker"><Icon name="check" size={18} /> Everyone confirmed</span><h2>Your activity is scheduled</h2><ArrangementSummary state={state} /></section> : null}

        {organizer && !["cancelled", "completed"].includes(state.lifecycle) ? <section className="event-panel event-danger-zone"><h2>Quest controls</h2><p>{state.lifecycle === "forming" ? "Cancel this quest if you no longer want to coordinate it." : "Return to group selection to replace someone, or cancel the quest for everyone."}</p><div className="split-actions">{state.lifecycle === "scheduled" ? <button className="primary-button" disabled={Boolean(busy)} onClick={() => void act("start", () => transitionEventQuest({ runId: state.runId, action: "start", expectedRevision: state.revision }))}>Start activity</button> : null}{state.lifecycle === "in_progress" ? <button className="primary-button" disabled={Boolean(busy)} onClick={() => void act("complete", () => transitionEventQuest({ runId: state.runId, action: "complete", expectedRevision: state.revision }))}>Mark completed</button> : null}{!["forming", "in_progress"].includes(state.lifecycle) ? <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void act("reopen", () => transitionEventQuest({ runId: state.runId, action: "reopen", expectedRevision: state.revision }))}>Edit the group</button> : null}<button className="quiet-button danger" disabled={Boolean(busy)} onClick={() => void act("cancel", () => transitionEventQuest({ runId: state.runId, action: "cancel", expectedRevision: state.revision }))}>Cancel quest</button></div></section> : null}

        {!organizer && ownInvitation?.status === "accepted" && ownMembership && !["cancelled", "completed"].includes(state.lifecycle) ? <section className="event-panel event-danger-zone"><h2>Can’t continue?</h2><p>Withdraw from this activity so the organizer can update the group and arrangement.</p><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void act("withdraw", () => transitionEventInvitation({ runId: state.runId, invitationId: ownInvitation.invitationId, action: "withdraw", expectedRevision: state.revision }))}>Withdraw from quest</button></section> : null}
      </article>
    </div>
  </div>;
}

function ArrangementSummary({ state }: { state: EventCoordinationState }) {
  const arrangement = state.arrangements.at(-1)!;
  return <dl className="arrangement-summary"><div><dt>Date and time</dt><dd>{formatWindow(arrangement.start, arrangement.end)}</dd></div><div><dt>Venue</dt><dd>{arrangement.venueName}<small>{arrangement.venueStatus === "externally_confirmed" ? "Venue availability verified" : arrangement.venueStatus === "participant_confirmed" ? "Confirmed by all participants; check public opening hours" : "Opening hours not yet verified"}</small></dd></div>{arrangement.materialChanges.length ? <div><dt>Requires reconfirmation</dt><dd>{arrangement.materialChanges.map((change) => change.replaceAll("_", " ")).join(", ")}</dd></div> : null}</dl>;
}

function localDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatWindow(start: string, end: string) {
  const from = new Date(start);
  const until = new Date(end);
  return `${from.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}, ${from.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function friendlyStatus(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function friendlyMember(value: string) {
  return value.replace(/^demo_/, "").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function participantRoster(state: EventCoordinationState) {
  const participants = new Map<string, {
    userId: string;
    source: "initiator" | "recommended" | "manual";
    proposedRole: string;
    explanation: string[];
  }>();
  for (const member of state.roster) participants.set(member.userId, member);
  for (const participant of state.proposal.proposedParticipants) {
    if (participants.has(participant.candidateId)) continue;
    participants.set(participant.candidateId, {
      userId: participant.candidateId,
      source: participant.candidateId === state.initiatorId ? "initiator" : "recommended",
      proposedRole: participant.proposedRole,
      explanation: ["Included in the current activity proposal"],
    });
  }
  for (const membership of state.memberships) {
    if (participants.has(membership.userId)) continue;
    participants.set(membership.userId, {
      userId: membership.userId,
      source: membership.rosterSource,
      proposedRole: membership.role,
      explanation: ["Activity member"],
    });
  }
  for (const invitation of state.invitations) {
    if (!["pending", "accepted"].includes(invitation.status)) continue;
    if (participants.has(invitation.guestId)) continue;
    participants.set(invitation.guestId, {
      userId: invitation.guestId,
      source: "recommended",
      proposedRole: "participant",
      explanation: ["Invited to the activity"],
    });
  }
  return [...participants.values()];
}
