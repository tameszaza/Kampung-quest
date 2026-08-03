"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ChatComposer, ChatDayLabel, ChatMessageBubble } from "@/components/chat-message";
import { Icon } from "@/components/icons";
import { useUser } from "@/components/user-context";
import {
  confirmAssistantConversation,
  createAssistantConversation,
  getAssistantConversation,
  getQuestRun,
  replayAssistantEvents,
  sendAssistantTurn,
} from "@/features/assistant/client";
import type {
  AssistantAnswer,
  AssistantBriefField,
  AssistantConversationSnapshot,
  AssistantWorkflowEvent,
  QuestRun,
} from "@/server/domain/schemas";

const CONVERSATION_KEY = "senior-quest-ai-conversation-id";
const LEGACY_DRAFT_KEY = "senior-quest-assistant-draft";

function localDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function tomorrowAt(hour: number) {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  value.setHours(hour, 0, 0, 0);
  return localDateTime(value);
}

function displayDate(start?: string, end?: string) {
  if (!start || !end) return "Not chosen";
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${startDate.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${startDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}–${endDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

const stageNames: Record<AssistantWorkflowEvent["stage"], string> = {
  brief: "Senior Quest",
  memory: "Memory Keeper",
  retrieval: "Neighbour Search",
  synthesis: "Matchmaker",
  validation: "Rules Check",
  safety: "Safety Guardian",
};

export function AssistantConversation({ embedded = false, resetToken = 0 }: {
  embedded?: boolean;
  resetToken?: number;
} = {}) {
  const { user } = useUser();
  const conversationKey = `${CONVERSATION_KEY}:${user.id}`;
  const [conversation, setConversation] = useState<AssistantConversationSnapshot | null>(null);
  const [quest, setQuest] = useState<QuestRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState("");
  const [editingField, setEditingField] = useState<AssistantBriefField | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingTurnId = useRef<string | null>(null);
  const reconnectConversationId = conversation?.conversationId ?? null;
  const reconnectStatus = conversation?.status ?? null;
  const reconnectAfterSequence = conversation?.events.at(-1)?.sequence ?? 0;

  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        window.localStorage.removeItem(LEGACY_DRAFT_KEY);
        window.localStorage.removeItem(CONVERSATION_KEY);
        const conversationId = window.localStorage.getItem(conversationKey);
        const restored = conversationId ? await getAssistantConversation(conversationId) : null;
        const next = restored ?? await createAssistantConversation(user.id);
        if (!active) return;
        window.localStorage.setItem(conversationKey, next.conversationId);
        setConversation(next);
        if (next.questRunId) setQuest(await getQuestRun(next.questRunId));
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Senior Quest could not start");
      } finally {
        if (active) setLoading(false);
      }
    }
    void restore();
    return () => { active = false; };
  }, [conversationKey, user.id]);

  useEffect(() => {
    if (!reconnectConversationId || reconnectStatus !== "processing" || confirming) return;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const conversationId = reconnectConversationId;

    async function reconnect() {
      try {
        const replayed = await replayAssistantEvents(conversationId, reconnectAfterSequence);
        const restored = await getAssistantConversation(conversationId);
        if (!active || !restored) return;
        const events = new Map(restored.events.map((event) => [event.sequence, event]));
        for (const event of replayed) events.set(event.sequence, event);
        const next = { ...restored, events: [...events.values()].sort((left, right) => left.sequence - right.sequence) };
        setConversation(next);
        if (next.questRunId) setQuest(await getQuestRun(next.questRunId));
        if (next.status === "processing") retryTimer = setTimeout(() => void reconnect(), 1_000);
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Agent progress could not be restored");
          retryTimer = setTimeout(() => void reconnect(), 2_000);
        }
      }
    }

    void reconnect();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [reconnectConversationId, reconnectStatus, confirming, reconnectAfterSequence]);

  const activeField = editingField ?? conversation?.nextField ?? null;
  const latestEvents = useMemo(() => {
    const byStage = new Map<AssistantWorkflowEvent["stage"], AssistantWorkflowEvent>();
    for (const event of conversation?.events ?? []) byStage.set(event.stage, event);
    return [...byStage.values()].sort((left, right) => left.sequence - right.sequence);
  }, [conversation?.events]);

  async function answer(answer: AssistantAnswer) {
    if (!conversation || thinking) return;
    setThinking(true);
    setError(null);
    pendingTurnId.current ??= crypto.randomUUID();
    try {
      const updated = await sendAssistantTurn(conversation, answer, pendingTurnId.current);
      setConversation(updated);
      pendingTurnId.current = null;
      setEditingField(null);
      setText("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Senior Quest could not respond");
      const restored = await getAssistantConversation(conversation.conversationId).catch(() => null);
      if (restored) setConversation(restored);
    } finally {
      setThinking(false);
    }
  }

  function submitText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeField || !text.trim()) return;
    if (activeField === "goal" || activeField === "interests" || activeField === "offers") {
      void answer({ field: activeField, value: text.trim() });
    }
  }

  async function confirm() {
    if (!conversation || confirming) return;
    setConfirming(true);
    setError(null);
    setConversation({ ...conversation, status: "processing" });
    try {
      const completed = await confirmAssistantConversation(conversation, (event) => {
        setConversation((current) => current ? {
          ...current,
          events: [...current.events.filter((item) => item.sequence !== event.sequence), event],
        } : current);
      });
      setConversation(completed);
      if (completed.questRunId) setQuest(await getQuestRun(completed.questRunId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Quest preparation failed");
      const restored = await getAssistantConversation(conversation.conversationId).catch(() => null);
      if (restored) setConversation(restored);
    } finally {
      setConfirming(false);
    }
  }

  async function startAgain() {
    setLoading(true);
    setError(null);
    try {
      const next = await createAssistantConversation(user.id);
      window.localStorage.setItem(conversationKey, next.conversationId);
      setConversation(next);
      setQuest(null);
      setEditingField(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Senior Quest could not start");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (resetToken <= 0) return;
    void startAgain();
    // The incrementing token deliberately triggers a fresh server conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken]);

  if (loading) return <div className="assistant-loading" role="status">Connecting to Senior Quest AI…</div>;
  if (!conversation) return <div className="connected-state error" role="alert">{error ?? "Senior Quest is unavailable"}</div>;

  return (
    <div className={`assistant-page${embedded ? " assistant-embedded" : ""}`}>
      {!embedded ? <header className="assistant-header">
        <Link className="icon-button" href="/home" aria-label="Back to home"><Icon name="back" /></Link>
        <div className="assistant-identity">
          <span className="assistant-mark" aria-hidden="true">♥</span>
          <span><strong>Senior Quest</strong><small><i className="ai-live-dot" /> Live AI community guide</small></span>
        </div>
        <button className="assistant-reset" type="button" onClick={() => void startAgain()}>New conversation</button>
      </header> : null}

      <main className="assistant-thread" aria-live="polite">
        {embedded ? <ChatDayLabel /> : null}
        {conversation.messages.map((message) => embedded ? (
          <ChatMessageBubble
            key={message.messageId}
            body={message.content}
            mine={message.role === "user"}
          />
        ) : message.role === "assistant" ? (
          <div className="assistant-row" key={message.messageId}>
            <span className="assistant-avatar" aria-hidden="true">♥</span>
            <p className="assistant-bubble">{message.content}</p>
          </div>
        ) : (
          <div className="assistant-exchange" key={message.messageId}>
            <p className="user-bubble">{message.content}</p>
          </div>
        ))}

        {thinking ? embedded ? (
          <ChatMessageBubble body="Senior Quest is thinking…" />
        ) : (
          <div className="assistant-row assistant-thinking" role="status">
            <span className="assistant-avatar" aria-hidden="true">♥</span>
            <p className="assistant-bubble"><span className="thinking-dots"><i /><i /><i /></span><small>Senior Quest is thinking</small></p>
          </div>
        ) : null}

        {conversation.status === "collecting" || editingField ? (
          <AnswerControl
            embedded={embedded}
            field={activeField}
            text={text}
            setText={setText}
            disabled={thinking}
            suggestedReplies={conversation.suggestedReplies}
            onText={submitText}
            onAnswer={(value) => void answer(value)}
          />
        ) : null}

        {conversation.status === "ready_for_review" && !editingField ? (
          <ReviewCard
            conversation={conversation}
            onEdit={setEditingField}
            onConfirm={() => void confirm()}
          />
        ) : null}

        {conversation.status === "processing" || confirming ? (
          <AgentProgress events={latestEvents} />
        ) : null}

        {conversation.status === "no_match" ? (
          <section className="assistant-result review-needed">
            <span className="result-icon"><Icon name="people" size={30} /></span>
            <h2>No strong match yet</h2>
            <p>{quest?.noMatch?.reason ?? "The available neighbours cannot directly support this request yet. Your request has been saved."}</p>
            <button className="secondary-button" type="button" onClick={() => setEditingField("goal")}>Adjust my request</button>
            <button className="text-button" type="button" onClick={() => void startAgain()}>Start a new conversation</button>
          </section>
        ) : null}

        {conversation.status === "complete" && quest ? <QuestResult quest={quest} ownCandidateId={user.id} onStartAgain={startAgain} /> : null}
        {conversation.status === "failed" || error ? (
          <div className="assistant-error" role="alert">
            <strong>{isQuotaError(error ?? conversation.error) ? "Gemini provider quota reached" : "Senior Quest paused"}</strong>
            <p>{error ?? conversation.error}</p>
            {conversation.status === "failed" ? <button className="secondary-button" type="button" onClick={() => void confirm()}>Retry without losing this conversation</button> : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}

function AnswerControl({ embedded, field, text, setText, disabled, suggestedReplies, onText, onAnswer }: {
  embedded: boolean;
  field: AssistantBriefField | null;
  text: string;
  setText: (value: string) => void;
  disabled: boolean;
  suggestedReplies: string[];
  onText: (event: FormEvent<HTMLFormElement>) => void;
  onAnswer: (answer: AssistantAnswer) => void;
}) {
  if (!field) return null;
  if (field === "goal" || field === "interests" || field === "offers") {
    if (embedded) {
      const canSkip = field === "interests" || field === "offers";
      return <div className="assistant-embedded-controls">
        {(suggestedReplies.length || canSkip) ? <div className="assistant-suggestion-list assistant-embedded-quick-replies" aria-label="Quick replies">
          {suggestedReplies.map((reply) => <button type="button" key={reply} disabled={disabled} onClick={() => onAnswer({ field, value: reply })}>{reply}</button>)}
          {canSkip ? <button type="button" disabled={disabled} onClick={() => onAnswer({ field, value: null })}>Nothing specific</button> : null}
        </div> : null}
        <ChatComposer
          multiline
          id="assistant-answer"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          onSubmit={onText}
          maxLength={2000}
          autoFocus
          disabled={disabled}
          placeholder="Type a message…"
        />
      </div>;
    }
    return <form className="assistant-composer" onSubmit={onText}>
      <label className="sr-only" htmlFor="assistant-answer">Your answer</label>
      <textarea id="assistant-answer" value={text} onChange={(event) => setText(event.target.value)} rows={3} autoFocus disabled={disabled} placeholder="Type naturally…" />
      {suggestedReplies.length ? <div className="assistant-suggestion-list assistant-suggestions">{suggestedReplies.map((reply) => <button type="button" key={reply} disabled={disabled} onClick={() => onAnswer({ field, value: reply })}>{reply}</button>)}</div> : null}
      <div className="assistant-composer-actions">
        {field === "interests" || field === "offers" ? <button className="text-button" type="button" disabled={disabled} onClick={() => onAnswer({ field, value: null })}>Nothing specific</button> : <span />}
        <button className="primary-button" type="submit" disabled={disabled || !text.trim()}>Send</button>
      </div>
    </form>;
  }
  if (field === "availability") return <AvailabilityControl disabled={disabled} onAnswer={onAnswer} />;
  const choices: Record<Exclude<AssistantBriefField, "goal" | "interests" | "offers" | "availability">, Array<[string, AssistantAnswer]>> = {
    group_size: [
      ["A pair or trio", { field: "group_size", value: { minimum: 2, maximum: 3 } }],
      ["About 3–4 people", { field: "group_size", value: { minimum: 3, maximum: 4 } }],
      ["Anything up to 5", { field: "group_size", value: { minimum: 2, maximum: 5 } }],
    ],
    indoor: [["Indoors, please", { field: "indoor", value: true }], ["Either is fine", { field: "indoor", value: false }]],
    stairs: [["Stairs are fine", { field: "stairs", value: true }], ["No stairs, please", { field: "stairs", value: false }]],
    distance: [["500 metres", { field: "distance", value: 500 }], ["1 kilometre", { field: "distance", value: 1000 }], ["2 kilometres", { field: "distance", value: 2000 }]],
    language: [["English", { field: "language", value: "English" }], ["中文", { field: "language", value: "Chinese" }], ["Bahasa Melayu", { field: "language", value: "Malay" }], ["தமிழ்", { field: "language", value: "Tamil" }]],
    consent: [["Yes, find a quest", { field: "consent", value: true }], ["Not yet", { field: "consent", value: false }]],
  };
  return <div className="assistant-choices">{choices[field].map(([label, answer]) => <button type="button" disabled={disabled} onClick={() => onAnswer(answer)} key={label}>{label}<Icon name="chevron" size={18} /></button>)}</div>;
}

function AvailabilityControl({ disabled, onAnswer }: { disabled: boolean; onAnswer: (answer: AssistantAnswer) => void }) {
  const [start, setStart] = useState(tomorrowAt(11));
  const [end, setEnd] = useState(tomorrowAt(14));
  return <form className="assistant-choice-panel" onSubmit={(event) => {
    event.preventDefault();
    onAnswer({ field: "availability", value: { start: new Date(start).toISOString(), end: new Date(end).toISOString() } });
  }}>
    <label>From<input type="datetime-local" required value={start} onChange={(event) => setStart(event.target.value)} /></label>
    <label>Until<input type="datetime-local" required value={end} onChange={(event) => setEnd(event.target.value)} /></label>
    <button className="primary-button" type="submit" disabled={disabled || Date.parse(end) <= Date.parse(start)}>Use this time</button>
  </form>;
}

function ReviewCard({ conversation, onEdit, onConfirm }: {
  conversation: AssistantConversationSnapshot;
  onEdit: (field: AssistantBriefField) => void;
  onConfirm: () => void;
}) {
  const brief = conversation.brief;
  const rows: Array<[string, string, AssistantBriefField]> = [
    ["Current request", brief.currentGoal ?? "Not provided", "goal"],
    ["Interests", brief.interests?.join(", ") || "Nothing specific", "interests"],
    ["What I can offer", brief.offers?.join(", ") || "Nothing specific", "offers"],
    ["When", displayDate(brief.availableWindows?.[0]?.start, brief.availableWindows?.[0]?.end), "availability"],
    ["Group", `${brief.minimumGroupSize}–${brief.maximumGroupSize} people`, "group_size"],
    ["Setting", brief.indoorRequired ? "Indoors" : "Indoor or outdoor", "indoor"],
    ["Stairs", brief.stairsAllowed ? "Comfortable" : "No stairs", "stairs"],
    ["Distance", `Up to ${(brief.maximumDistanceM ?? 0) / 1000} km`, "distance"],
    ["Language", brief.language ?? "Not provided", "language"],
    ["Invitation consent", brief.invitationConsent ? "Yes—find a quest" : "Not granted", "consent"],
  ];
  return <section className="assistant-review">
    <h2>Review the quest brief</h2>
    <p>This current request—not older goals—will guide matchmaking.</p>
    <dl>{rows.map(([label, value, field]) => <div key={field}><dt>{label}</dt><dd>{value}</dd><button type="button" onClick={() => onEdit(field)}>Edit</button></div>)}</dl>
    <button className="primary-button" type="button" disabled={!brief.invitationConsent} onClick={onConfirm}>{brief.invitationConsent ? "Confirm and find my quest" : "Grant consent before matchmaking"}</button>
  </section>;
}

function AgentProgress({ events }: { events: AssistantWorkflowEvent[] }) {
  return <section className="assistant-progress" role="status">
    <h2>Your agent team is working</h2>
    {events.map((event) => <div className={event.status === "completed" ? "active" : ""} key={`${event.stage}-${event.sequence}`}>
      <span>{event.status === "completed" ? "✓" : event.status === "failed" ? "!" : "…"}</span>
      <p><strong>{stageNames[event.stage]}</strong><small>{event.kind === "agent" ? "AI agent" : "System check"} · {event.message}</small></p>
    </div>)}
  </section>;
}

function QuestResult({ quest, ownCandidateId, onStartAgain }: {
  quest: QuestRun;
  ownCandidateId: string;
  onStartAgain: () => Promise<void>;
}) {
  const proposal = quest.proposal;
  if (!proposal) return null;
  const needsHumanReview = quest.status === "human_review";
  return <section className="assistant-result">
    <span className="result-kicker"><Icon name={needsHumanReview ? "shield" : "check"} size={18} /> {needsHumanReview ? "Coordinator review required" : "Agent-checked quest ready"}</span>
    <h2>{proposal.quest.title}</h2>
    <p>{proposal.quest.description}</p>
    <div className="result-facts">
      <span><Icon name="calendar" />{displayDate(proposal.quest.proposedTimeWindow.start, proposal.quest.proposedTimeWindow.end)}</span>
      <span><Icon name="clock" />About {proposal.quest.durationMinutes} minutes</span>
      <span><Icon name="people" />{proposal.quest.groupSize} people</span>
    </div>
    <div className="result-people">
      <h3>Everyone has a role</h3>
      {proposal.proposedParticipants.map((participant) => {
        const name = candidateName(participant.candidateId, ownCandidateId);
        return <div key={participant.candidateId}><span>{name.slice(0, 1)}</span><p><strong>{name}</strong><small>{friendlyRole(participant.proposedRole)}</small></p></div>;
      })}
    </div>
    {needsHumanReview ? <p className="assistant-note">No invitation was prepared. A human coordinator must review this proposal and its safety or constraint checks first.</p> : null}
    <div className="assistant-result-actions">
      <Link className="primary-button" href={`/quests/${quest.runId}`}>{needsHumanReview ? "Review quest details" : "View quest details"}</Link>
      <button className="text-button" type="button" onClick={() => void onStartAgain()}>Tell me something new</button>
    </div>
    <p className="demo-disclosure">Demo neighbours are clearly labeled data profiles; no real messages are sent.</p>
  </section>;
}

function isQuotaError(message: string | null) {
  return Boolean(message && /quota|rate limit|too many requests/i.test(message));
}

function candidateName(candidateId: string, ownCandidateId: string) {
  const names: Record<string, string> = {
    demo_anne: "Anne",
    demo_david: "David",
    demo_john: "John",
    demo_mei: "Mei",
    demo_aisha: "Aisha",
    demo_ravi: "Ravi",
    demo_lim: "Lim",
    demo_sofia: "Sofia",
    demo_farah: "Farah",
    demo_kumar: "Kumar",
    demo_helen: "Helen",
    demo_noor: "Noor",
  };
  return candidateId === ownCandidateId ? "You" : names[candidateId] ?? "A neighbour";
}

function friendlyRole(role: string) {
  if (role === "quest_host") return "Quest host";
  return role.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
