"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChatDayLabel, ChatMessageBubble } from "@/components/chat-message";
import { Icon } from "@/components/icons";
import {
  confirmEventRequirements,
  getEventCoordinationThread,
  getEventQuest,
  respondToEventInvitation,
  sendEventCoordinationMessage,
} from "@/features/events/client";
import type { EventCoordinationState, EventCoordinationThread } from "@/server/domain/event-coordination";

export function EventCoordinationConversation({ runId }: { runId: string }) {
  const [thread, setThread] = useState<EventCoordinationThread | null>(null);
  const [quest, setQuest] = useState<EventCoordinationState | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([getEventCoordinationThread(runId), getEventQuest(runId)]).then(([nextThread, nextQuest]) => {
      if (!active) return;
      setThread(nextThread);
      setQuest(nextQuest);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Coordination chat could not be loaded");
    });
    return () => { active = false; };
  }, [runId]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!thread || busy) return;
    const form = event.currentTarget;
    const input = form.elements.namedItem("message") as HTMLInputElement;
    const body = input.value.trim();
    if (!body) return;
    setBusy("message");
    input.value = "";
    try {
      setThread(await sendEventCoordinationMessage({ runId, body, expectedRevision: thread.revision }));
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    } catch (reason) {
      input.value = body;
      setError(reason instanceof Error ? reason.message : "Message could not be sent");
    } finally { setBusy(""); }
  }

  async function confirmRequirements() {
    if (!thread) return;
    setBusy("requirements");
    try { setThread(await confirmEventRequirements(runId, thread.revision)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Requirements could not be confirmed"); }
    finally { setBusy(""); }
  }

  async function respond(response: "accept" | "decline") {
    const invitation = quest?.invitations.find((candidate) => candidate.status === "pending");
    if (!quest || !invitation) return;
    setBusy("invitation");
    try {
      setQuest(await respondToEventInvitation({
        runId,
        invitationId: invitation.invitationId,
        response,
        expectedRevision: quest.revision,
      }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Invitation response could not be saved"); }
    finally { setBusy(""); }
  }

  if (!thread && !error) return <div className="connected-state" role="status"><span className="connected-spinner" />Opening private coordination…</div>;
  if (!thread) return <div className="connected-state error" role="alert"><Icon name="shield" />{error}<Link href="/my-quests">Back to My Activities</Link></div>;
  const pendingInvitation = quest?.invitations.find((invitation) => invitation.status === "pending");

  return <div className="event-coordination-chat">
    <header className="chat-header event-chat-header"><Link className="icon-button" href={pendingInvitation ? "/quests" : "/my-quests"} aria-label="Back"><Icon name="back" /></Link><span className="assistant-chat-avatar" aria-hidden="true">♥</span><span><h2>Quest Coordinator</h2><p>{quest?.proposal.quest.title ?? "Private activity coordination"}</p></span><Link className="quiet-button" href={`/quests/${runId}`}>Activity details</Link></header>
    {error ? <div className="chat-alert" role="alert">{error}<button type="button" onClick={() => setError("")}>Dismiss</button></div> : null}
    {pendingInvitation ? <section className="coordination-invitation-card"><span className="result-kicker"><Icon name="invite" size={18} /> Invitation</span><h2>{quest?.proposal.quest.title}</h2><p>{quest?.proposal.quest.description}</p><dl className="invitation-facts"><div><dt>Invited by</dt><dd>{friendlyMember(quest?.initiatorId ?? "")}</dd></div><div><dt>Visible group</dt><dd>{quest?.roster.map((member) => friendlyMember(member.userId)).join(", ")}</dd></div><div><dt>Provisional availability</dt><dd>{quest?.proposal.quest.proposedTimeWindow ? formatWindow(quest.proposal.quest.proposedTimeWindow.start, quest.proposal.quest.proposedTimeWindow.end) : "To be discussed"}</dd></div><div><dt>Venue</dt><dd>{quest?.arrangements.at(-1)?.venueName ?? "To be coordinated"}</dd></div></dl><p>These times are availability only. Accept to coordinate; the final schedule and venue require separate confirmation.</p><div className="split-actions"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void respond("decline")}>Decline</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => void respond("accept")}>Accept & coordinate</button></div></section> : null}
    <div className="message-history event-message-history" aria-live="polite"><ChatDayLabel />{thread.messages.map((message) => <ChatMessageBubble key={message.messageId} body={message.body} mine={message.role === "participant"} heading={message.role === "assistant" ? "Quest Coordinator" : message.role === "system" ? "Activity update" : undefined} time={new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} />)}<div ref={bottomRef} /></div>
    {!pendingInvitation && thread.pendingRequirements ? <section className="pending-requirements"><span><Icon name="shield" size={18} /> Private requirement proposal</span><p>{requirementSummary(thread.pendingRequirements)}</p><button className="primary-button" disabled={busy === "requirements"} onClick={() => void confirmRequirements()}>{busy === "requirements" ? "Confirming…" : "Confirm these requirements"}</button></section> : null}
    {!pendingInvitation ? <form className="chat-composer event-chat-composer" onSubmit={send}><label className="sr-only" htmlFor="coordination-message">Message the coordinator</label><input id="coordination-message" name="message" maxLength={2000} placeholder="Share availability or other requirements…" disabled={Boolean(busy)} /><button type="submit" aria-label="Send" disabled={Boolean(busy)}><Icon name="chevron" /></button></form> : <p className="coordination-accept-note">Accept the invitation to start a private coordination conversation.</p>}
  </div>;
}

function requirementSummary(requirements: NonNullable<EventCoordinationThread["pendingRequirements"]>) {
  return Object.entries(requirements)
    .flatMap(([label, values]) => values?.length ? [`${label.replaceAll(/([A-Z])/g, " $1").toLowerCase()}: ${values.map((value) => typeof value === "string" ? value : `${value.start}–${value.end}`).join(", ")}`] : [])
    .join(" · ");
}

function friendlyMember(value: string) {
  return value.replace(/^demo_/, "").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function formatWindow(start: string, end: string) {
  const from = new Date(start);
  const until = new Date(end);
  return `${from.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, ${from.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}
