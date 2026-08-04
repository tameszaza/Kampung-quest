"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ChatComposer, ChatDayLabel, ChatMessageBubble } from "@/components/chat-message";
import { Icon } from "@/components/icons";
import { createClientRequestId } from "@/lib/client-request-id";
import { ProfileAvatar } from "@/components/profile-avatar";
import { questParticipantStatus } from "@/lib/quest-participant-status";
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
import type { AvailabilityWindow, WeeklyAvailabilityRule } from "@/server/domain/schemas";
import { expandAvailability } from "@/server/features/availability-service";

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

  const refreshConversationId = conversation?.conversationId ?? null;
  const refreshStatus = conversation?.status ?? null;
  const refreshQuestRunId = conversation?.questRunId ?? null;
  const refreshUpdatedAt = conversation?.updatedAt ?? null;

  useEffect(() => {
    if (!refreshConversationId || !refreshStatus || !["no_match", "complete"].includes(refreshStatus)) return;
    let active = true;
    const refresh = async () => {
      const latest = await getAssistantConversation(refreshConversationId).catch(() => null);
      if (!active || !latest) return;
      if (latest.status !== refreshStatus || latest.questRunId !== refreshQuestRunId || latest.updatedAt !== refreshUpdatedAt) {
        setConversation(latest);
        if (latest.questRunId) setQuest(await getQuestRun(latest.questRunId));
      }
    };
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshConversationId, refreshStatus, refreshQuestRunId, refreshUpdatedAt]);

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
    pendingTurnId.current ??= createClientRequestId();
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

        {/* Once the user chooses to adjust the request, the result card is no
         * longer an active step. Keeping it mounted alongside the composer
         * makes the two controls overlap in the embedded/mobile chat. */}
        {conversation.status === "no_match" && !editingField ? (
          <section className="assistant-result review-needed">
            <span className="result-icon"><Icon name="people" size={30} /></span>
            <h2>No strong match yet</h2>
            <p>{quest?.noMatch?.reason ?? "The available neighbours cannot directly support this request yet. Your request has been saved."}</p>
            <button className="secondary-button" type="button" onClick={() => { setError(null); setText(""); setEditingField("goal"); }}>Adjust my request</button>
            <button className="text-button" type="button" onClick={() => void startAgain()}>Start a new conversation</button>
          </section>
        ) : null}

        {conversation.status === "complete" && quest ? <QuestResult quest={quest} ownCandidateId={user.id} onStartAgain={startAgain} /> : null}
        {conversation.status === "failed" || error ? (
          <div className="assistant-error" role="alert">
            <strong>{isQuotaError(error ?? conversation.error) ? "Gemini provider quota reached" : "Senior Quest paused"}</strong>
            <p>{friendlyAgentError(error ?? conversation.error)}</p>
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
  const [mode, setMode] = useState<"specific" | "weekly">("specific");
  const [start, setStart] = useState(tomorrowAt(11));
  const [end, setEnd] = useState(tomorrowAt(14));
  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [days, setDays] = useState<number[]>([]);
  const [weeklyStart, setWeeklyStart] = useState("09:00");
  const [weeklyEnd, setWeeklyEnd] = useState("12:00");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [patternText, setPatternText] = useState("");
  const [patternError, setPatternError] = useState("");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Singapore";
  const specificSelection = specificAvailabilityWindows(windows, start, end, timeZone);

  function addWindow() {
    if (Date.parse(end) <= Date.parse(start)) return;
    const next = { start: new Date(start).toISOString(), end: new Date(end).toISOString(), timeZone };
    setWindows((items) => [...items, next].sort((left, right) => Date.parse(left.start) - Date.parse(right.start)));
  }

  function applyPreset(preset: "weekday_mornings" | "tuesday_evening") {
    if (preset === "weekday_mornings") {
      setDays([1, 2, 3, 4, 5]);
      setWeeklyStart("09:00");
      setWeeklyEnd("12:00");
    } else {
      setDays([2]);
      setWeeklyStart("17:00");
      setWeeklyEnd("20:00");
    }
  }

  function interpretPattern() {
    const interpreted = parseWeeklyPattern(patternText);
    if (!interpreted) {
      setPatternError("Try a pattern such as ‘weekday mornings’, ‘Tuesday evening’, or ‘weekends afternoon’. ");
      return;
    }
    setDays(interpreted.days);
    setWeeklyStart(interpreted.start);
    setWeeklyEnd(interpreted.end);
    setPatternError("");
  }

  return <form className="assistant-choice-panel availability-panel" onSubmit={(event) => {
    event.preventDefault();
    if (mode === "specific") {
      if (!specificSelection.length) return;
      onAnswer({ field: "availability", value: { availableWindows: specificSelection, recurringAvailabilityRules: [] } });
      return;
    }
    const rule: WeeklyAvailabilityRule = {
      kind: "weekly_recurrence",
      daysOfWeek: days,
      startLocalTime: weeklyStart,
      endLocalTime: weeklyEnd,
      timeZone,
      validFrom,
      validUntil,
    };
    const availableWindows = expandAvailability({
      explicitWindows: [],
      recurringRules: [rule],
      horizon: { start: validFrom, end: validUntil },
    });
    onAnswer({ field: "availability", value: { availableWindows, recurringAvailabilityRules: [rule] } });
  }}>
    <div className="availability-mode" role="group" aria-label="Availability type"><button type="button" className={mode === "specific" ? "active" : ""} onClick={() => setMode("specific")}>Specific times</button><button type="button" className={mode === "weekly" ? "active" : ""} onClick={() => setMode("weekly")}>Weekly pattern</button></div>
    <div className="availability-heading"><strong>When are you available?</strong><small>These times help us find a match. They are not the activity schedule.</small></div>
    {mode === "specific" ? <>
      <label>Available from<input type="datetime-local" required value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label>Available until<input type="datetime-local" required value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      <button className="secondary-button" type="button" disabled={disabled || Date.parse(end) <= Date.parse(start)} onClick={addWindow}>Add available time</button>
      {windows.length ? <ul className="availability-list">{windows.map((window, index) => <li key={`${window.start}-${window.end}`}><span>{displayDate(window.start, window.end)}</span><button type="button" onClick={() => setWindows((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></li>)}</ul> : null}
      <button className="primary-button" type="submit" disabled={disabled || specificSelection.length === 0}>Confirm {specificSelection.length || ""} available time{specificSelection.length === 1 ? "" : "s"}</button>
    </> : <>
      <div className="availability-natural-entry"><label>Describe a weekly pattern (optional)<input type="text" value={patternText} onChange={(event) => setPatternText(event.target.value)} placeholder="For example, weekday mornings" /></label><button className="secondary-button" type="button" disabled={!patternText.trim()} onClick={interpretPattern}>Interpret</button></div>
      {patternError ? <p className="field-error" role="alert">{patternError}</p> : null}
      <div className="assistant-suggestions availability-presets"><button type="button" onClick={() => applyPreset("weekday_mornings")}>Weekday mornings</button><button type="button" onClick={() => applyPreset("tuesday_evening")}>Tuesday evening</button></div>
      <fieldset className="weekday-picker"><legend>Available days</legend>{[[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]].map(([day, label]) => <label key={day}><input type="checkbox" checked={days.includes(day as number)} onChange={() => setDays((items) => items.includes(day as number) ? items.filter((item) => item !== day) : [...items, day as number].sort())} /><span>{label}</span></label>)}</fieldset>
      <label>From<input type="time" value={weeklyStart} required onChange={(event) => setWeeklyStart(event.target.value)} /></label>
      <label>Until<input type="time" value={weeklyEnd} required onChange={(event) => setWeeklyEnd(event.target.value)} /></label>
      <label>Starting on<input type="date" value={validFrom} required onChange={(event) => setValidFrom(event.target.value)} /></label>
      <label>Ending on<input type="date" value={validUntil} required onChange={(event) => setValidUntil(event.target.value)} /></label>
      {days.length && validFrom && validUntil ? <div className="availability-interpretation"><strong>Please confirm this interpretation</strong><p>Every {days.map((day) => ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day]).join(", ")} from {weeklyStart} to {weeklyEnd}, {validFrom} through {validUntil} ({timeZone}).</p></div> : null}
      <button className="primary-button" type="submit" disabled={disabled || !days.length || !validFrom || !validUntil || validUntil < validFrom || weeklyEnd <= weeklyStart}>Confirm weekly availability</button>
    </>}
  </form>;
}

function parseWeeklyPattern(value: string): { days: number[]; start: string; end: string } | null {
  const normalized = value.toLowerCase().trim();
  const dayNames = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const days = normalized.includes("weekday")
    ? [1, 2, 3, 4, 5]
    : normalized.includes("weekend")
      ? [6, 7]
      : dayNames.flatMap((name, index) => normalized.includes(name) ? [index + 1] : []);
  const period = normalized.includes("morning")
    ? { start: "09:00", end: "12:00" }
    : normalized.includes("afternoon")
      ? { start: "12:00", end: "16:00" }
      : normalized.includes("evening")
        ? { start: "17:00", end: "20:00" }
        : null;
  return days.length && period ? { days, ...period } : null;
}

export function specificAvailabilityWindows(
  savedWindows: AvailabilityWindow[],
  currentStart: string,
  currentEnd: string,
  timeZone: string,
): AvailabilityWindow[] {
  if (savedWindows.length) return savedWindows;
  const start = Date.parse(currentStart);
  const end = Date.parse(currentEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  return [{
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    timeZone,
  }];
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
    ["Available times", brief.recurringAvailabilityRules?.length
      ? `${brief.recurringAvailabilityRules.length} weekly pattern${brief.recurringAvailabilityRules.length === 1 ? "" : "s"} · ${brief.availableWindows?.length ?? 0} matching windows`
      : brief.availableWindows?.map((window) => displayDate(window.start, window.end)).join("; ") || "Not chosen", "availability"],
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
  const includesDemoNeighbour = proposal.proposedParticipants.some((participant) => participant.candidateId.startsWith("demo_"));
  return <section className="assistant-result">
    <span className="result-kicker"><Icon name={needsHumanReview ? "shield" : "check"} size={18} /> {needsHumanReview ? "Coordinator review required" : "Agent-checked quest ready"}</span>
    <h2>{proposal.quest.title}</h2>
    <p>{proposal.quest.description}</p>
    <div className="result-facts">
      <span><Icon name="calendar" /><strong>Provisional availability:</strong> {displayDate(proposal.quest.proposedTimeWindow.start, proposal.quest.proposedTimeWindow.end)} · not scheduled</span>
      <span><Icon name="clock" />About {proposal.quest.durationMinutes} minutes</span>
      <span><Icon name="people" />{proposal.proposedParticipants.length} people</span>
    </div>
    <div className="result-people">
      <h3>Everyone has a role</h3>
      {proposal.proposedParticipants.map((participant) => {
        const profile = quest.participantProfiles?.find((candidate) => candidate.candidateId === participant.candidateId);
        const name = profile?.displayName ?? candidateName(participant.candidateId, ownCandidateId);
        const status = questParticipantStatus(
          participant.candidateId,
          ownCandidateId,
          quest.coordination?.invitations.find((invitation) => invitation.candidateId === participant.candidateId)?.status,
        );
        return <div className="result-person-row" key={participant.candidateId}><ProfileAvatar name={name} photoUrl={profile?.photoUrl} size={40} className="result-person-avatar" /><p><strong>{name}</strong><small>{friendlyRole(participant.proposedRole)}</small></p><span className={`participant-status participant-status-${status.key}`}>{status.label}</span></div>;
      })}
    </div>
    {needsHumanReview ? <p className="assistant-note">No invitation was prepared. A human coordinator must review this proposal and its safety or constraint checks first.</p> : null}
    <div className="assistant-result-actions">
      <Link className="primary-button" href={`/quests/${quest.runId}`}>{needsHumanReview ? "Review quest details" : "View quest details"}</Link>
      <button className="text-button" type="button" onClick={() => void onStartAgain()}>Tell me something new</button>
    </div>
    {includesDemoNeighbour ? <p className="demo-disclosure">Demo neighbours are clearly labeled data profiles; no real messages are sent.</p> : null}
  </section>;
}

function isQuotaError(message: string | null) {
  return Boolean(message && /quota|rate limit|too many requests/i.test(message));
}

function friendlyAgentError(message: string | null) {
  if (!message) return "The agent team could not complete this step. Please try again.";
  if (/unknown (?:need|offer|quest need) fact reference|unknown (?:participant|reserve) alias|could not verify.*participant facts/i.test(message)) {
    return "The matchmaking team could not verify the supplied member information. Please retry without changing your request.";
  }
  return message;
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
