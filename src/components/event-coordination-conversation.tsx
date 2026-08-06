"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ChatComposer, ChatDayLabel, ChatMessageBubble } from "@/components/chat-message";
import { Icon } from "@/components/icons";
import { ProfileAvatar } from "@/components/profile-avatar";
import {
  confirmEventRequirements,
  decideEventArrangement,
  getEventCoordinationThread,
  getEventGroupCoordinationThread,
  getEventQuest,
  markEventNotificationsRead,
  respondToEventInvitation,
  sendEventCoordinationMessage,
  sendEventGroupCoordinationMessage,
  suggestEventArrangement,
} from "@/features/events/client";
import { coordinationMessagePresentation } from "@/features/events/coordination-message-presentation";
import type {
  EventCoordinationThread,
  EventGroupCoordinationThread,
  EventParticipantProgress,
  EventQuestView,
} from "@/server/domain/event-coordination";
import type { ChatMessageSync } from "@/server/identity/types";
import { createClientRequestId } from "@/lib/client-request-id";

const REFRESH_INTERVAL_MS = 10_000;
const REFRESH_COOLDOWN_MS = 1_000;

export function EventCoordinationConversation({ runId, embedded = false, showHeader = true, onBack, onTitle, scope: controlledScope, onScopeChange, onGroupAvailabilityChange }: {
  runId: string;
  embedded?: boolean;
  showHeader?: boolean;
  onBack?: () => void;
  onTitle?: (title: string, memberCount: number) => void;
  scope?: "private" | "group";
  onScopeChange?: (scope: "private" | "group") => void;
  onGroupAvailabilityChange?: (available: boolean) => void;
}) {
  const [thread, setThread] = useState<EventCoordinationThread | null>(null);
  const [groupThread, setGroupThread] = useState<EventGroupCoordinationThread | null>(null);
  const [scope, setScope] = useState<"private" | "group">("private");
  const [quest, setQuest] = useState<EventQuestView | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const initialLoadInFlightRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const acknowledgedNotificationsRef = useRef("");
  const privateSyncRef = useRef<{ runId: string; cursor: string | null; hasMore: boolean } | null>(null);
  const groupSyncRef = useRef<{ runId: string; cursor: string | null; hasMore: boolean } | null>(null);
  const threadRef = useRef<EventCoordinationThread | null>(null);
  const groupThreadRef = useRef<EventGroupCoordinationThread | null>(null);
  const onTitleRef = useRef(onTitle);
  const onScopeChangeRef = useRef(onScopeChange);
  const onGroupAvailabilityChangeRef = useRef(onGroupAvailabilityChange);
  const activeScope = controlledScope ?? scope;

  threadRef.current = thread;
  groupThreadRef.current = groupThread;

  onTitleRef.current = onTitle;
  onScopeChangeRef.current = onScopeChange;
  onGroupAvailabilityChangeRef.current = onGroupAvailabilityChange;

  const scrollToLatest = useCallback(() => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, []);

  const load = useCallback(async (quiet = false) => {
    try {
      const privateSync = privateSyncRef.current?.runId === runId ? privateSyncRef.current : null;
      const [rawThread, nextQuest] = await Promise.all([
        getThreadWithFallback(
          () => getEventCoordinationThread(runId, privateSync?.cursor ?? undefined),
          () => getEventCoordinationThread(runId),
          Boolean(privateSync?.cursor),
        ),
        getEventQuest(runId),
      ]);
      const nextThread = mergeCoordinationThread(threadRef.current, rawThread);
      privateSyncRef.current = { runId, cursor: rawThread.sync.cursor, hasMore: rawThread.sync.hasMore };
      if (!nextQuest) throw new Error("This activity could not be found");
      const activeMemberCount = nextQuest.memberships.filter((membership) => isActiveMembershipStatus(membership.status)).length;
      const groupAvailable = activeMemberCount >= 2 && ["organizer", "participant"].includes(nextQuest.viewer.role);
      const groupSync = groupSyncRef.current?.runId === runId ? groupSyncRef.current : null;
      const rawGroupThread = groupAvailable && activeScope === "group"
        ? await getThreadWithFallback(
          () => getEventGroupCoordinationThread(runId, groupSync?.cursor ?? undefined),
          () => getEventGroupCoordinationThread(runId),
          Boolean(groupSync?.cursor),
        )
        : null;
      const nextGroupThread = rawGroupThread ? mergeCoordinationThread(groupThreadRef.current, rawGroupThread) : null;
      if (rawGroupThread) groupSyncRef.current = { runId, cursor: rawGroupThread.sync.cursor, hasMore: rawGroupThread.sync.hasMore };
      setThread(nextThread);
      if (nextGroupThread || !groupAvailable) setGroupThread(nextGroupThread);
      onGroupAvailabilityChangeRef.current?.(groupAvailable);
      if (!groupAvailable) {
        setScope("private");
        onScopeChangeRef.current?.("private");
      }
      setQuest(nextQuest);
      onTitleRef.current?.(nextQuest.proposal.quest.title, nextQuest.participantProgress.length);
      setError("");
      if (!quiet) scrollToLatest();
      const unreadSignature = nextQuest.notifications.filter((item) =>
        item.readAt === null && (activeScope === "group" ? item.kind === "group_message" : item.kind !== "group_message"))
        .map((item) => item.notificationId).sort().join(":");
      if (unreadSignature && acknowledgedNotificationsRef.current !== unreadSignature) {
        acknowledgedNotificationsRef.current = unreadSignature;
        void markEventNotificationsRead(runId, activeScope === "group").catch(() => {
          acknowledgedNotificationsRef.current = "";
        });
      }
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : "Coordination could not be loaded");
    } finally {
      lastLoadedAtRef.current = Date.now();
      if (!quiet) {
        hasLoadedRef.current = true;
        setLoading(false);
      }
    }
  }, [activeScope, runId, scrollToLatest]);

  const refresh = useCallback(async () => {
    if (
      !hasLoadedRef.current
      || refreshInFlightRef.current
      || Date.now() - lastLoadedAtRef.current < REFRESH_COOLDOWN_MS
    ) return;
    refreshInFlightRef.current = true;
    try {
      await load(true);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [load]);

  useEffect(() => {
    let active = true;
    const initialLoad = window.setTimeout(() => {
      if (!active || initialLoadInFlightRef.current) return;
      if (hasLoadedRef.current) {
        void refresh();
        return;
      }
      initialLoadInFlightRef.current = true;
      void load().finally(() => {
        initialLoadInFlightRef.current = false;
      });
    }, 0);
    const refreshWhenActive = () => {
      if (active && !sendingRef.current && document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(refreshWhenActive, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      active = false;
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [load, refresh]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!thread || !quest?.viewer.canChat || !body || busy || sending) return;
    const activeThread = activeScope === "group" ? groupThread : thread;
    if (!activeThread) return;
    const clientMessageId = createClientRequestId();
    const optimisticMessage = {
      messageId: clientMessageId,
      senderId: activeScope === "group" ? thread.userId : undefined,
      role: "participant" as const,
      body,
      kind: "text" as const,
      receipt: "delivered" as const,
      createdAt: new Date().toISOString(),
    };
    setSending(true);
    sendingRef.current = true;
    setPendingMessageId(clientMessageId);
    setError("");
    setDraft("");
    if (activeScope === "group") {
      setGroupThread({ ...activeThread as EventGroupCoordinationThread, messages: [...activeThread.messages, optimisticMessage] });
    } else {
      setThread({ ...activeThread as EventCoordinationThread, messages: [...activeThread.messages, optimisticMessage] });
    }
    scrollToLatest();
    try {
      if (activeScope === "group") {
        const nextGroupThread = await sendEventGroupCoordinationMessage({ runId, body, expectedRevision: activeThread.revision, clientMessageId });
        groupSyncRef.current = { runId, cursor: nextGroupThread.sync.cursor, hasMore: nextGroupThread.sync.hasMore };
        setGroupThread(nextGroupThread);
      } else {
        const nextThread = await sendEventCoordinationMessage({ runId, body, expectedRevision: activeThread.revision, clientMessageId });
        privateSyncRef.current = { runId, cursor: nextThread.sync.cursor, hasMore: nextThread.sync.hasMore };
        setThread(nextThread);
      }
      void refreshQuest().catch(() => {
        // The faster thread response is authoritative for the message. Polling
        // will reconcile the activity summary after a transient fetch failure.
      });
      scrollToLatest();
    } catch (reason) {
      const messageError = reason instanceof Error ? reason.message : "Message could not be sent";
      try {
        const reconciled = activeScope === "group"
          ? await getEventGroupCoordinationThread(runId)
          : await getEventCoordinationThread(runId);
        const delivered = reconciled.messages.some((message) => message.messageId === clientMessageId);
        if (activeScope === "group") {
          groupSyncRef.current = { runId, cursor: reconciled.sync.cursor, hasMore: reconciled.sync.hasMore };
          setGroupThread(reconciled as EventGroupCoordinationThread);
        } else {
          privateSyncRef.current = { runId, cursor: reconciled.sync.cursor, hasMore: reconciled.sync.hasMore };
          setThread(reconciled as EventCoordinationThread);
        }
        if (delivered) {
          setError("");
        } else {
          setDraft(body);
          setError(messageError);
        }
      } catch {
        setDraft(body);
        setError(messageError);
        if (activeScope === "group") {
          setGroupThread((value) => value ? { ...value, messages: value.messages.filter((message) => message.messageId !== clientMessageId) } : value);
        } else {
          setThread((value) => value ? { ...value, messages: value.messages.filter((message) => message.messageId !== clientMessageId) } : value);
        }
      }
    } finally {
      setSending(false);
      sendingRef.current = false;
      setPendingMessageId(null);
    }
  }

  function submitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function refreshQuest() {
    const nextQuest = await getEventQuest(runId);
    if (nextQuest) setQuest(nextQuest);
  }

  async function confirmRequirements() {
    if (!thread || busy) return;
    setBusy("requirements");
    setError("");
    try {
      setThread(await confirmEventRequirements(runId, thread.revision));
      await refreshQuest();
      scrollToLatest();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Availability could not be saved");
    } finally {
      setBusy("");
    }
  }

  async function respond(response: "accept" | "decline") {
    const invitationId = quest?.viewer.pendingInvitationId;
    if (!quest || !invitationId || busy) return;
    setBusy("invitation");
    setError("");
    try {
      await respondToEventInvitation({
        runId,
        invitationId,
        response,
        expectedRevision: quest.revision,
      });
      if (response === "decline") {
        window.location.assign("/quests");
        return;
      }
      await load(true);
      scrollToLatest();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invitation response could not be saved");
    } finally {
      setBusy("");
    }
  }

  async function coordinateArrangement(label: string, action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(label);
    setError("");
    try {
      await action();
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The arrangement could not be updated");
    } finally {
      setBusy("");
    }
  }

  if (loading) return <CoordinationSkeleton />;
  if (!thread || !quest) return <div className="connected-state error coordination-load-error" role="alert"><Icon name="shield" /><strong>{error || "Coordination could not be loaded"}</strong><button className="secondary-button" type="button" onClick={() => { setLoading(true); void load(); }}>Try again</button><Link href="/my-quests">Back to My Activities</Link></div>;

  const pendingInvitation = quest.viewer.role === "pending_invitee";
  const backHref = pendingInvitation ? "/quests" : "/my-quests";
  const finalized = [...quest.arrangements].reverse().find((arrangement) => arrangement.status === "finalized");
  const latestArrangement = quest.arrangements.at(-1);
  const workingArrangement = latestArrangement?.status === "awaiting_participant_confirmation" ? latestArrangement : null;
  const proposed = quest.proposal.quest.proposedTimeWindow;
  const schedule = finalized
    ? formatWindow(finalized.start, finalized.end, quest.timeZone)
    : workingArrangement
      ? formatWindow(workingArrangement.start, workingArrangement.end, quest.timeZone)
      : proposed ? formatWindow(proposed.start, proposed.end, quest.timeZone) : "Still to be discussed";
  const venue = finalized?.venueName ?? latestArrangement?.venueName ?? "Still to be coordinated";
  const joinedCount = quest.participantProgress.filter((participant) =>
    participant.invitationStatus === "organizer" || isActiveMembershipStatus(participant.membershipStatus)).length;
  const title = quest.proposal.quest.title;
  const activeMessages = activeScope === "group" ? groupThread?.messages ?? [] : thread.messages;

  const overviewDetails = <>
    <dl className="coordination-facts">
      <div><dt><Icon name="calendar" size={18} /> {finalized ? "Confirmed time" : workingArrangement ? "Working appointment" : "Available time"}</dt><dd>{schedule}</dd>{!finalized ? <small>{workingArrangement ? "Waiting for everyone to confirm" : "Not scheduled yet"}</small> : null}</div>
      <div><dt><Icon name="pin" size={18} /> Venue</dt><dd>{venue}</dd></div>
    </dl>
    <ProgressSummary participants={quest.participantProgress} joinedCount={joinedCount} />
    {quest.viewer.role === "organizer" ? <div className="coordination-organizer-note"><Icon name="bell" size={18} /><p><strong>You’re coordinating this activity.</strong><span>We’ll alert you when a guest shares or confirms availability.</span></p></div> : null}
  </>;

  return <div className={`coordination-hub${embedded ? " coordination-hub-embedded" : ""}${!showHeader ? " coordination-hub-no-header" : ""}`}>
    {showHeader ? <header className="coordination-hub-header">
      {embedded ? <button className="icon-button coordination-back" type="button" onClick={onBack} aria-label="Back to messages"><Icon name="back" /></button> : <Link className="icon-button" href={backHref} aria-label="Back"><Icon name="back" /></Link>}
      <div className="coordination-hub-title">
        <span className="coordination-mark" aria-hidden="true">♥</span>
        <span><strong>Senior Quest</strong><small>Activity coordinator</small></span>
      </div>
      <Link className="coordination-details-link" href={`/quests/${encodeURIComponent(runId)}`}>Activity details <Icon name="chevron" size={16} /></Link>
    </header> : null}

    <div className="coordination-hub-layout">
      <aside className="coordination-overview" aria-label="Activity coordination overview">
        <div className="coordination-role-line">
          <span className={`coordination-role coordination-role-${quest.viewer.role}`}>{roleLabel(quest.viewer.role)}</span>
          <span>{friendlyLifecycle(quest.lifecycle)}</span>
        </div>
        <h1>{title}</h1>
        <p className="coordination-purpose">{quest.proposal.quest.description}</p>

        <div className="coordination-desktop-details">{overviewDetails}</div>
        <details className="coordination-mobile-details"><summary>Schedule, venue &amp; group</summary><div>{overviewDetails}</div></details>
      </aside>

      <section className="coordination-conversation" aria-label={`${activeScope === "private" ? "Private coordination" : "Group chat"} for ${title}`}>
        <header className="coordination-conversation-header">
          <div><span className="coordination-online" aria-hidden="true" /><h2>{activeScope === "private" ? "Private coordination" : "Group chat"}</h2></div>
          <p>{activeScope === "private"
            ? quest.viewer.role === "organizer" ? "Plan the activity with Senior Quest" : "Only you and Senior Quest can see your details"
            : `${joinedCount} members · Senior Quest helps when coordination comes up`}</p>
          {groupThread && !embedded ? <div className="coordination-scope-tabs" role="tablist" aria-label="Coordination conversations">
            <button type="button" role="tab" aria-selected={activeScope === "private"} onClick={() => { setScope("private"); onScopeChange?.("private"); }}>Private coordination</button>
            <button type="button" role="tab" aria-selected={activeScope === "group"} onClick={() => { setScope("group"); onScopeChange?.("group"); }}>Group chat</button>
          </div> : null}
        </header>

        <div className="coordination-conversation-notices">
          {error ? <div className="chat-alert coordination-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>Dismiss</button></div> : null}

          {pendingInvitation ? <section className="coordination-invite-decision" aria-labelledby="invitation-heading">
            <div className="coordination-invite-copy"><span><Icon name="invite" size={19} /> You’re invited</span><h2 id="invitation-heading">Join the group before coordinating</h2><p>Accepting means you want to take part. The final time and venue will be confirmed separately.</p></div>
            <div className="coordination-invite-actions"><button className="quiet-button" disabled={Boolean(busy)} onClick={() => void respond("decline")}>Decline</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => void respond("accept")}>{busy === "invitation" ? "Saving…" : "Join & coordinate"}</button></div>
          </section> : null}
        </div>

        <div className="message-history coordination-message-history" aria-live="polite" aria-busy={sending}>
          <ChatDayLabel />
          {activeMessages.map((message) => {
            const presentation = coordinationMessagePresentation(message.kind);
            return <ChatMessageBubble
              key={message.messageId}
              body={message.body}
              mine={activeScope === "group" ? message.senderId === thread.userId : message.role === "participant"}
              heading={message.role === "assistant" ? "Senior Quest" : message.role === "system" ? "Activity update" : activeScope === "group" && message.senderId !== thread.userId
                ? quest.participantProgress.find((participant) => participant.userId === message.senderId)?.displayName ?? "Community member"
                : undefined}
              time={new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              receipt={message.messageId !== pendingMessageId && message.role === "participant" && (activeScope === "private" || message.senderId === thread.userId)
                ? message.receipt ?? "delivered"
                : undefined}
              actionLabel={message.messageId === pendingMessageId ? "Sending…" : undefined}
              variant={presentation.variant}
              label={presentation.label}
            />;
          })}
          {sending ? <div className="coordination-agent-working" role="status"><span aria-hidden="true" />Senior Quest is checking the group’s preferences…</div> : null}
          {activeScope === "private" && quest.viewer.role === "organizer" && thread.messages.length <= 1 ? <div className="coordination-starting-prompts">
            <span className="coordination-prompt-icon"><Icon name="message" size={22} /></span>
            <h3>Start with what matters most</h3>
            <p>Senior Quest already knows this activity. Ask about timing, the venue, or what the group needs next.</p>
            <div><button type="button" onClick={() => setDraft("Who are we still waiting to hear from?")}>Who are we waiting for?</button><button type="button" onClick={() => setDraft("Help me choose the next coordination step.")}>What should I do next?</button></div>
          </div> : null}
          <div ref={bottomRef} />
        </div>

        <div className="coordination-conversation-actions">
          <ArrangementAction
            quest={quest}
            currentUserId={thread.userId}
            busy={busy}
            onSuggest={() => coordinateArrangement("suggest-arrangement", () => suggestEventArrangement(runId, quest.revision))}
            onDecide={(action) => coordinateArrangement(`${action}-arrangement`, () => decideEventArrangement({
              runId,
              arrangementId: latestArrangement!.arrangementId,
              action,
              expectedRevision: quest.revision,
            }))}
          />

          {activeScope === "private" && quest.viewer.canChat && thread.pendingRequirements ? <section className="pending-requirements coordination-save-card">
            <div><span><Icon name="check" size={18} /> Senior Quest understood</span><p>{requirementSummary(thread.pendingRequirements)}</p><small>Check this before it is used to coordinate the activity.</small></div>
            <button className="primary-button" disabled={busy === "requirements"} onClick={() => void confirmRequirements()}>{busy === "requirements" ? "Saving…" : saveLabel(thread.pendingRequirements)}</button>
          </section> : null}

          {quest.viewer.canChat ? <ChatComposer
            id="coordination-message"
            inputValue={draft}
            onInputChange={(event) => setDraft(event.target.value)}
            onInputKeyDown={submitOnEnter}
            onSubmit={send}
            maxLength={2_000}
            disabled={Boolean(busy) || sending}
            placeholder={activeScope === "group" ? "Message the group or ask Senior Quest…" : quest.viewer.role === "organizer" ? "Ask Senior Quest about this activity…" : "Share availability or anything you need…"}
          /> : <div className="coordination-chat-locked"><Icon name="lock" size={18} /><span>Join the activity to start your private coordination chat.</span></div>}
        </div>
      </section>
    </div>
  </div>;
}

function ProgressSummary({ participants, joinedCount }: {
  participants: EventParticipantProgress[];
  joinedCount: number;
}) {
  return <section className="coordination-progress" aria-label="Group progress">
    <div className="coordination-section-heading"><span><Icon name="people" size={19} /></span><div><h2>Group progress</h2><p>{joinedCount} of {participants.length} people joined</p></div></div>
    <div className="coordination-progress-bar" aria-hidden="true"><span style={{ width: `${participants.length ? (joinedCount / participants.length) * 100 : 0}%` }} /></div>
    <ul className="coordination-participants">
      {participants.map((participant) => <ParticipantProgress key={participant.userId} participant={participant} />)}
    </ul>
  </section>;
}

function ArrangementAction({ quest, currentUserId, busy, onSuggest, onDecide }: {
  quest: EventQuestView;
  currentUserId: string;
  busy: string;
  onSuggest: () => Promise<void>;
  onDecide: (action: "approve" | "reject" | "confirm") => Promise<void>;
}) {
  const arrangement = quest.arrangements.at(-1);
  const terminalArrangement = !arrangement || ["finalized", "rejected", "superseded"].includes(arrangement.status);
  const canStartArrangement = quest.viewer.role === "organizer"
    && ["awaiting_responses", "coordinating"].includes(quest.lifecycle)
    && terminalArrangement;
  const ownConfirmation = arrangement?.confirmations.find((confirmation) => confirmation.userId === currentUserId);
  const needsParticipantDecision = ["organizer", "participant"].includes(quest.viewer.role)
    && arrangement?.status === "awaiting_participant_confirmation"
    && ownConfirmation?.status === "pending";
  if (!canStartArrangement && !(quest.viewer.role === "organizer" && arrangement?.status === "proposed") && !needsParticipantDecision) return null;

  return <section className="coordination-arrangement-action" aria-live="polite">
    <div>
      <span><Icon name="calendar" size={18} /> Current coordination step</span>
      {canStartArrangement ? <><h3>Turn confirmed availability into a plan</h3><p>Senior Quest can find a compatible time and prepare it for your approval.</p></> : null}
      {arrangement && !canStartArrangement ? <><h3>{needsParticipantDecision ? "Does this arrangement work for you?" : "Review the proposed arrangement"}</h3><p>{formatWindow(arrangement.start, arrangement.end, quest.timeZone)} · {arrangement.venueName}</p></> : null}
    </div>
    <div className="coordination-arrangement-buttons">
      {canStartArrangement ? <><Link className="secondary-button" href={`/quests/${encodeURIComponent(quest.runId)}`}>Enter a different plan</Link><button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void onSuggest()}>{busy === "suggest-arrangement" ? "Comparing…" : "Suggest best plan"}</button></> : null}
      {quest.viewer.role === "organizer" && arrangement?.status === "proposed" ? <><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void onDecide("reject")}>Adjust it</button><button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void onDecide("approve")}>{busy === "approve-arrangement" ? "Approving…" : "Approve & ask everyone"}</button></> : null}
      {needsParticipantDecision ? <><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void onDecide("reject")}>I can’t make this</button><button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void onDecide("confirm")}>{busy === "confirm-arrangement" ? "Confirming…" : "Confirm arrangement"}</button></> : null}
    </div>
  </section>;
}

function ParticipantProgress({ participant }: { participant: EventParticipantProgress }) {
  const inactive = participant.membershipStatus !== null && !isActiveMembershipStatus(participant.membershipStatus);
  const status = inactive
    ? { label: "No longer participating", tone: "declined" }
    : participant.availabilityStatus === "confirmed"
    ? { label: "Availability confirmed", tone: "ready" }
    : participant.availabilityStatus === "awaiting_confirmation"
      ? { label: "Availability shared", tone: "shared" }
      : participant.invitationStatus === "pending"
        ? { label: "Waiting for response", tone: "waiting" }
        : participant.invitationStatus === "declined"
          ? { label: "Declined", tone: "declined" }
          : { label: participant.invitationStatus === "organizer" ? "Organizer" : "Joined", tone: "joined" };
  return <li>
    <ProfileAvatar name={participant.displayName} photoUrl={participant.photoUrl} size={40} />
    <span><strong>{participant.displayName}</strong><small>{status.label}</small></span>
    <i className={`participant-status-dot participant-status-${status.tone}`} aria-hidden="true" />
  </li>;
}

function isActiveMembershipStatus(status: EventParticipantProgress["membershipStatus"]) {
  return status !== null && !["withdrawn", "replaced", "cancelled", "completed"].includes(status);
}

async function getThreadWithFallback<T>(load: () => Promise<T>, reload: () => Promise<T>, hasCursor: boolean) {
  try {
    return await load();
  } catch (reason) {
    if (!hasCursor) throw reason;
    return reload();
  }
}

function mergeCoordinationThread<T extends { messages: EventCoordinationThread["messages"]; sync: ChatMessageSync }>(
  current: { messages: EventCoordinationThread["messages"] } | null,
  next: T,
): T {
  if (!current || next.sync.mode !== "delta" || next.sync.resetRequired) return next;
  const messages = new Map(current.messages.map((message) => [message.messageId, message]));
  for (const message of next.messages) messages.set(message.messageId, message);
  return {
    ...next,
    messages: [...messages.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.messageId.localeCompare(right.messageId)),
  };
}

function CoordinationSkeleton() {
  return <div className="coordination-hub coordination-hub-skeleton" role="status" aria-label="Opening activity coordination">
    <div className="coordination-skeleton-header" />
    <div className="coordination-skeleton-layout"><div /><div /></div>
  </div>;
}

function requirementSummary(requirements: NonNullable<EventCoordinationThread["pendingRequirements"]>) {
  return Object.entries(requirements)
    .flatMap(([label, values]) => {
      if (label === "availableWindows" && Array.isArray(values) && values.length === 0) return ["No available times in this period"];
      if (!values?.length) return [];
      if (label === "availableWindows") return [`${values.length} availability ${values.length === 1 ? "window" : "windows"}`];
      return [`${friendlyRequirement(label)}: ${values.join(", ")}`];
    })
    .join(" · ");
}

function saveLabel(requirements: NonNullable<EventCoordinationThread["pendingRequirements"]>) {
  return Object.prototype.hasOwnProperty.call(requirements, "availableWindows")
    || Object.prototype.hasOwnProperty.call(requirements, "temporaryConflicts")
    ? "Save my availability"
    : "Save these details";
}

function friendlyRequirement(value: string) {
  return value.replaceAll(/([A-Z])/g, " $1").replaceAll("_", " ").trim().replace(/^./, (letter) => letter.toUpperCase());
}

function formatWindow(start: string, end: string, timeZone?: string) {
  const from = new Date(start);
  const until = new Date(end);
  return `${from.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", timeZone })}, ${from.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone })}–${until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone })}`;
}

function friendlyLifecycle(value: string) {
  if (value === "awaiting_responses") return "Invitations sent";
  if (value === "awaiting_confirmation") return "Confirming the plan";
  if (value === "scheduled") return "Scheduled";
  if (value === "coordinating") return "Coordinating";
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function roleLabel(role: EventQuestView["viewer"]["role"]) {
  if (role === "organizer") return "You’re the organizer";
  if (role === "selected") return "You’re selected for this activity";
  if (role === "applicant") return "Your request is being reviewed";
  if (role === "pending_invitee") return "Invitation awaiting your response";
  return "You’re part of this activity";
}
