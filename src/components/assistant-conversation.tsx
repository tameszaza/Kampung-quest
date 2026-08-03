"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Icon } from "@/components/icons";
import { getQuestRun, requestRecommendation } from "@/features/assistant/client";
import {
  assistantConversationReducer,
  createAssistantConversation,
  toRecommendationRequest,
  type AssistantConversationState,
  type AssistantStep,
} from "@/features/assistant/conversation";
import type { QuestRun } from "@/server/domain/schemas";
import { useUser } from "@/components/user-context";

const DRAFT_KEY = "senior-quest-assistant-draft";

const prompts: Record<Exclude<AssistantStep, "submitting" | "complete">, string> = {
  need: "What would make your day easier or more enjoyable?",
  interests: "What kinds of things do you enjoy?",
  offers: "Is there something you would enjoy sharing or helping with?",
  availability: "When would you be comfortable meeting?",
  group_size: "What size group feels comfortable?",
  setting: "Would you prefer to meet indoors?",
  stairs: "Are stairs comfortable for you?",
  distance: "How far would you be comfortable travelling?",
  language: "Which language should the group use?",
  consent: "May I look for suitable neighbours and prepare a quest invitation?",
  review: "Here is what I understood. Please check it before I search.",
};

function newConversationId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `conversation_${Date.now()}`;
}

function readDraft(): AssistantConversationState | null {
  try {
    const value = window.localStorage.getItem(DRAFT_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<AssistantConversationState>;
    if (!parsed.conversationId || !parsed.step || typeof parsed.narrative !== "string") return null;
    return parsed as AssistantConversationState;
  } catch {
    return null;
  }
}

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

function futureWindow(daysAhead: number, startHour: number, endHour: number) {
  const start = new Date();
  start.setDate(start.getDate() + daysAhead);
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(start);
  end.setHours(endHour, 0, 0, 0);
  return { start: localDateTime(start), end: localDateTime(end) };
}

function nextWeekendWindow() {
  const today = new Date();
  const daysUntilSaturday = (6 - today.getDay() + 7) % 7 || 7;
  return futureWindow(daysUntilSaturday, 8, 11);
}

function displayDate(start?: string, end?: string) {
  if (!start || !end) return "Not chosen";
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${startDate.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  })}, ${startDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}–${endDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function candidateName(candidateId: string, ownCandidateId: string) {
  const names: Record<string, string> = {
    maria: "You",
    demo_anne: "Anne",
    demo_david: "David",
    demo_john: "John",
    demo_mei: "Mei",
  };
  return candidateId === ownCandidateId ? "You" : names[candidateId] ?? "A neighbour";
}

function friendlyRole(role: string) {
  if (role === "quest_host") return "Quest host";
  return role.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function AssistantConversation({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useUser();
  const [state, dispatch] = useReducer(
    assistantConversationReducer,
    createAssistantConversation("conversation_pending"),
  );
  const [hydrated, setHydrated] = useState(false);
  const [text, setText] = useState("");
  const [availabilityStart, setAvailabilityStart] = useState("");
  const [availabilityEnd, setAvailabilityEnd] = useState("");
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [quest, setQuest] = useState<QuestRun | null>(null);
  const [progress, setProgress] = useState(0);
  const latestRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const draft = readDraft() ?? createAssistantConversation(newConversationId());
    /* eslint-disable react-hooks/set-state-in-effect -- Restore a client-only draft after hydration. */
    dispatch({
      type: "restore",
      state: draft.step === "submitting" ? { ...draft, step: "review" } : draft,
    });
    setAvailabilityStart(draft.availableStart ? localDateTime(new Date(draft.availableStart)) : tomorrowAt(11));
    setAvailabilityEnd(draft.availableEnd ? localDateTime(new Date(draft.availableEnd)) : tomorrowAt(14));
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (state.step === "complete") window.localStorage.removeItem(DRAFT_KEY);
    else window.localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  useEffect(() => {
    latestRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [state.step]);

  useEffect(() => {
    if (state.step !== "submitting") return;
    const timer = window.setInterval(() => setProgress((current) => Math.min(2, current + 1)), 900);
    return () => window.clearInterval(timer);
  }, [state.step]);

  useEffect(() => {
    if (state.step !== "complete" || !state.questRunId || quest) return;
    void getQuestRun(state.questRunId).then((run) => setQuest(run)).catch(() => undefined);
  }, [quest, state.questRunId, state.step]);

  const transcript = useMemo(() => {
    const items: Array<{
      prompt: string;
      answer: string;
      step: Exclude<AssistantStep, "submitting" | "complete">;
    }> = [];
    if (state.narrative) items.push({ prompt: prompts.need, answer: state.narrative, step: "need" });
    if (state.step !== "need" && state.step !== "interests") {
      items.push({ prompt: prompts.interests, answer: state.interests[0] ?? "Nothing specific", step: "interests" });
    }
    if (!["need", "interests", "offers"].includes(state.step)) {
      items.push({ prompt: prompts.offers, answer: state.offers[0] ?? "Just happy to join in", step: "offers" });
    }
    if (state.availableStart) items.push({ prompt: prompts.availability, answer: displayDate(state.availableStart, state.availableEnd), step: "availability" });
    if (state.minimumGroupSize) items.push({ prompt: prompts.group_size, answer: `${state.minimumGroupSize}–${state.maximumGroupSize} people`, step: "group_size" });
    if (state.indoorRequired !== undefined) items.push({ prompt: prompts.setting, answer: state.indoorRequired ? "Indoors, please" : "Either is fine", step: "setting" });
    if (state.stairsAllowed !== undefined) items.push({ prompt: prompts.stairs, answer: state.stairsAllowed ? "Yes" : "No stairs, please", step: "stairs" });
    if (state.maximumDistanceM) items.push({ prompt: prompts.distance, answer: `Up to ${state.maximumDistanceM / 1000} km`, step: "distance" });
    if (state.language) items.push({ prompt: prompts.language, answer: state.language, step: "language" });
    if (state.invitationConsent !== undefined) items.push({ prompt: prompts.consent, answer: state.invitationConsent ? "Yes, please search" : "Not yet", step: "consent" });
    return items;
  }, [state]);

  function answerText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    dispatch({ type: "answer_text", value: text });
    setText("");
  }

  function answerAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const start = new Date(availabilityStart).toISOString();
    const end = new Date(availabilityEnd).toISOString();
    if (Date.parse(end) <= Date.parse(start)) {
      setAvailabilityError("Please choose an end time after the start time.");
      return;
    }
    setAvailabilityError(null);
    dispatch({ type: "set_availability", start, end });
  }

  function chooseAvailability(daysAhead: number, startHour: number, endHour: number) {
    const window = futureWindow(daysAhead, startHour, endHour);
    setAvailabilityStart(window.start);
    setAvailabilityEnd(window.end);
    setAvailabilityError(null);
  }

  function chooseWeekendAvailability() {
    const window = nextWeekendWindow();
    setAvailabilityStart(window.start);
    setAvailabilityEnd(window.end);
    setAvailabilityError(null);
  }

  async function submitRecommendation() {
    try {
      dispatch({ type: "submission_started" });
      setProgress(0);
      const result = await requestRecommendation(toRecommendationRequest(state, user.id));
      setQuest(result.quest);
      dispatch({ type: "submission_succeeded", questRunId: result.quest.runId });
    } catch (error) {
      dispatch({
        type: "submission_failed",
        error: error instanceof Error ? error.message : "I could not prepare a quest just now.",
      });
    }
  }

  function startAgain() {
    const conversationId = newConversationId();
    dispatch({ type: "reset", conversationId });
    setQuest(null);
    setText("");
    setAvailabilityStart(tomorrowAt(11));
    setAvailabilityEnd(tomorrowAt(14));
    setAvailabilityError(null);
  }

  if (!hydrated) {
    return <div className="assistant-loading" role="status">Preparing your Senior Quest assistant…</div>;
  }

  const currentPrompt = state.step !== "submitting" && state.step !== "complete"
    ? prompts[state.step]
    : null;

  const firstName = user.fullName.split(/\s+/)[0] || user.fullName;

  return (
    <div className={`assistant-page${embedded ? " assistant-embedded" : ""}`}>
      {!embedded ? <header className="assistant-header">
        <Link className="icon-button" href="/home" aria-label="Back to home"><Icon name="back" /></Link>
        <div className="assistant-identity">
          <span className="assistant-mark" aria-hidden="true">♥</span>
          <span><strong>Senior Quest</strong><small>Your friendly community helper</small></span>
        </div>
        <button className="assistant-reset" type="button" onClick={startAgain}>Start over</button>
      </header> : null}

      <main className="assistant-thread" aria-live="polite">
        {embedded ? <div className="assistant-inline-tools">
          <span>Tell me what would feel helpful or enjoyable today.</span>
          <button className="assistant-reset" type="button" onClick={startAgain}>Start over</button>
        </div> : null}
        <div className="assistant-welcome">
          <span className="assistant-avatar" aria-hidden="true">♥</span>
          <div className="assistant-bubble">
            <strong>Hello {firstName}, I&apos;m here to help.</strong>
            <p>Tell me what would feel helpful or enjoyable, and I&apos;ll look for a safe activity with nearby neighbours.</p>
          </div>
        </div>

        {transcript.map((item) => (
          <div className="assistant-exchange" key={item.step}>
            <div className="assistant-row"><span className="assistant-avatar" aria-hidden="true">♥</span><p className="assistant-bubble">{item.prompt}</p></div>
            <button className="user-bubble" type="button" onClick={() => dispatch({ type: "edit", step: item.step })} title="Edit this answer">{item.answer}<small>Edit</small></button>
          </div>
        ))}

        {currentPrompt && state.step !== "review" ? (
          <div className="assistant-row" ref={latestRef}>
            <span className="assistant-avatar" aria-hidden="true">♥</span>
            <div className="assistant-bubble"><strong>{currentPrompt}</strong></div>
          </div>
        ) : null}

        {["need", "interests", "offers"].includes(state.step) ? (
          <form className="assistant-composer" onSubmit={answerText}>
            <label className="sr-only" htmlFor="assistant-answer">Your answer</label>
            <textarea
              id="assistant-answer"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={state.step === "need" ? "For example: I would enjoy company over lunch…" : "Type your answer…"}
              rows={3}
              autoFocus
            />
            <div className="assistant-composer-actions">
              {state.step !== "need" ? <button className="text-button" type="button" onClick={() => dispatch({ type: "skip_text" })}>Skip for now</button> : <span />}
              <button className="primary-button" type="submit" disabled={!text.trim()}>Continue</button>
            </div>
          </form>
        ) : null}

        {state.step === "availability" ? (
          <form className="assistant-choice-panel" onSubmit={answerAvailability}>
            <div className="availability-quick-replies" aria-label="Suggested meeting times">
              <button type="button" onClick={() => chooseAvailability(1, 11, 14)}>Tomorrow at lunch</button>
              <button type="button" onClick={() => chooseAvailability(1, 14, 17)}>Tomorrow afternoon</button>
              <button type="button" onClick={chooseWeekendAvailability}>Weekend morning</button>
            </div>
            <label>From<input type="datetime-local" required value={availabilityStart} onChange={(event) => setAvailabilityStart(event.target.value)} /></label>
            <label>Until<input type="datetime-local" required value={availabilityEnd} onChange={(event) => setAvailabilityEnd(event.target.value)} /></label>
            {availabilityError ? <p className="assistant-error" role="alert">{availabilityError}</p> : null}
            <button className="primary-button" type="submit">Use this time</button>
          </form>
        ) : null}

        {state.step === "group_size" ? <ChoiceButtons choices={[
          ["A small pair or trio", () => dispatch({ type: "set_group_size", minimum: 2, maximum: 3 })],
          ["About 3–4 people", () => dispatch({ type: "set_group_size", minimum: 3, maximum: 4 })],
          ["Anything up to 5", () => dispatch({ type: "set_group_size", minimum: 2, maximum: 5 })],
        ]} /> : null}
        {state.step === "setting" ? <ChoiceButtons choices={[
          ["Indoors, please", () => dispatch({ type: "set_setting", indoorRequired: true })],
          ["Either is fine", () => dispatch({ type: "set_setting", indoorRequired: false })],
        ]} /> : null}
        {state.step === "stairs" ? <ChoiceButtons choices={[
          ["Yes, stairs are fine", () => dispatch({ type: "set_stairs", stairsAllowed: true })],
          ["No stairs, please", () => dispatch({ type: "set_stairs", stairsAllowed: false })],
        ]} /> : null}
        {state.step === "distance" ? <ChoiceButtons choices={[
          ["Up to 500 metres", () => dispatch({ type: "set_distance", maximumDistanceM: 500 })],
          ["Up to 1 kilometre", () => dispatch({ type: "set_distance", maximumDistanceM: 1000 })],
          ["Up to 2 kilometres", () => dispatch({ type: "set_distance", maximumDistanceM: 2000 })],
        ]} /> : null}
        {state.step === "language" ? <ChoiceButtons choices={[
          ["English", () => dispatch({ type: "set_language", language: "English" })],
          ["中文", () => dispatch({ type: "set_language", language: "Chinese" })],
          ["Bahasa Melayu", () => dispatch({ type: "set_language", language: "Malay" })],
          ["தமிழ்", () => dispatch({ type: "set_language", language: "Tamil" })],
        ]} /> : null}
        {state.step === "consent" ? <ChoiceButtons choices={[
          ["Yes, find a quest", () => dispatch({ type: "set_consent", invitationConsent: true })],
          ["Not yet", () => dispatch({ type: "set_consent", invitationConsent: false })],
        ]} /> : null}

        {state.step === "review" ? (
          <section className="assistant-review" ref={latestRef}>
            <div className="assistant-row"><span className="assistant-avatar" aria-hidden="true">♥</span><div className="assistant-bubble"><strong>{prompts.review}</strong></div></div>
            <dl>
              <div><dt>You&apos;re looking for</dt><dd>{state.narrative}</dd></div>
              <div><dt>When</dt><dd>{displayDate(state.availableStart, state.availableEnd)}</dd></div>
              <div><dt>Group</dt><dd>{state.minimumGroupSize}–{state.maximumGroupSize} people</dd></div>
              <div><dt>Access</dt><dd>{state.indoorRequired ? "Indoors" : "Indoor or outdoor"}; {state.stairsAllowed ? "stairs are okay" : "no stairs"}</dd></div>
              <div><dt>Distance</dt><dd>Up to {(state.maximumDistanceM ?? 0) / 1000} km</dd></div>
              <div><dt>Language</dt><dd>{state.language}</dd></div>
            </dl>
            {state.error ? <p className="assistant-error" role="alert">{state.error}</p> : null}
            {!state.invitationConsent ? <p className="assistant-note">I will not search until you give permission. You can edit your consent above.</p> : null}
            <div className="assistant-review-actions">
              <button className="secondary-button" type="button" onClick={() => dispatch({ type: "edit", step: "need" })}>Edit answers</button>
              <button className="primary-button" type="button" disabled={!state.invitationConsent} onClick={submitRecommendation}>{state.error ? "Try again" : "Find my quest"}</button>
            </div>
          </section>
        ) : null}

        {state.step === "submitting" ? (
          <section className="assistant-progress" ref={latestRef} role="status">
            {["Remembering your preferences", "Finding suitable neighbours", "Checking the quest for safety"].map((label, index) => (
              <div className={index <= progress ? "active" : ""} key={label}><span>{index < progress ? "✓" : index + 1}</span>{label}</div>
            ))}
          </section>
        ) : null}

        {state.step === "complete" && quest ? <QuestResult quest={quest} ownCandidateId={user.id} onStartAgain={startAgain} /> : null}
      </main>
    </div>
  );
}

function ChoiceButtons({ choices }: { choices: Array<[string, () => void]> }) {
  return <div className="assistant-choices">{choices.map(([label, action]) => <button type="button" onClick={action} key={label}>{label}<Icon name="chevron" size={18} /></button>)}</div>;
}

function QuestResult({ quest, ownCandidateId, onStartAgain }: { quest: QuestRun; ownCandidateId: string; onStartAgain: () => void }) {
  const proposal = quest.proposal;
  if (quest.status === "failed" || !proposal) {
    return (
      <section className="assistant-result review-needed">
        <span className="result-icon"><Icon name="shield" size={30} /></span>
        <h2>I couldn&apos;t finish this quest</h2>
        <p>Your preferences are safely remembered. Please try the conversation again when you are ready.</p>
        <button className="secondary-button" type="button" onClick={onStartAgain}>Start again</button>
      </section>
    );
  }
  if (quest.status === "human_review") {
    return (
      <section className="assistant-result review-needed">
        <span className="result-icon"><Icon name="shield" size={30} /></span>
        <h2>This quest needs a little more checking</h2>
        <p>Your preferences are safely remembered. A coordinator should review the match before anyone is invited.</p>
        <button className="secondary-button" type="button" onClick={onStartAgain}>Adjust my answers</button>
      </section>
    );
  }
  return (
    <section className="assistant-result">
      <span className="result-kicker"><Icon name="check" size={18} /> A safe match is ready</span>
      <h2>{proposal.quest.title}</h2>
      <p>{proposal.quest.description}</p>
      <div className="result-facts">
        <span><Icon name="calendar" />{displayDate(proposal.quest.proposedTimeWindow.start, proposal.quest.proposedTimeWindow.end)}</span>
        <span><Icon name="clock" />About {proposal.quest.durationMinutes} minutes</span>
        <span><Icon name="people" />{proposal.quest.groupSize} people</span>
        <span><Icon name="pin" />Venue needs: {proposal.quest.venueRequirements.map((item) => item.replaceAll("_", " ")).join(", ")}</span>
      </div>
      <div className="result-people">
        <h3>Everyone has a role</h3>
        {proposal.proposedParticipants.map((participant) => (
          <div key={participant.candidateId}><span>{candidateName(participant.candidateId, ownCandidateId).slice(0, 1)}</span><p><strong>{candidateName(participant.candidateId, ownCandidateId)}</strong><small>{friendlyRole(participant.proposedRole)}</small></p></div>
        ))}
      </div>
      <div className="assistant-result-actions">
        <Link className="primary-button" href={`/quests/${quest.runId}`}>View quest details</Link>
        <button className="text-button" type="button" onClick={onStartAgain}>Tell me something new</button>
      </div>
      <p className="demo-disclosure">Demo mode: invitations are prepared in the engine, but no real messages are sent.</p>
    </section>
  );
}
