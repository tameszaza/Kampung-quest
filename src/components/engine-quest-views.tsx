"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EngineQuestCard, questDate, questImage } from "@/components/engine-quest-card";
import { ActivityActions } from "@/components/activity-actions";
import { Icon } from "@/components/icons";
import { QuestCard } from "@/components/quest-card";
import { getQuestRun, listUserQuests } from "@/features/assistant/client";
import { quests } from "@/data/mock-data";
import type { QuestRun } from "@/server/domain/schemas";
import { useUser } from "@/components/user-context";

type LoadState<T> =
  | { status: "loading"; value: T }
  | { status: "ready"; value: T }
  | { status: "error"; value: T; message: string };

export function EngineQuestList() {
  const { user } = useUser();
  const [state, setState] = useState<LoadState<QuestRun[]>>({ status: "loading", value: [] });

  useEffect(() => {
    let active = true;
    void listUserQuests(user.id).then((runs) => {
      if (active) setState({ status: "ready", value: runs });
    }).catch((error) => {
      if (active) setState({ status: "error", value: [], message: error instanceof Error ? error.message : "Could not load quests" });
    });
    return () => { active = false; };
  }, [user.id]);

  if (state.status === "loading") return <ConnectedLoading label="Loading your recommendations…" />;
  if (state.status === "error") return <ConnectedError message={state.message} />;
  const visibleRuns = state.value.filter((run) => run.proposal !== null);
  if (visibleRuns.length === 0) return <section className="quest-grid" aria-label="Featured activities">{quests.map((quest) => <QuestCard key={quest.slug} quest={quest} />)}</section>;
  return <section className="quest-grid" aria-label="Your recommended quests">{visibleRuns.map((run) => <EngineQuestCard key={run.runId} run={run} />)}</section>;
}

export function LatestEngineQuest() {
  const { user } = useUser();
  const [state, setState] = useState<LoadState<QuestRun | null>>({ status: "loading", value: null });
  useEffect(() => {
    let active = true;
    void listUserQuests(user.id, 10).then((runs) => {
      if (active) setState({ status: "ready", value: runs.find((run) => run.proposal !== null) ?? null });
    }).catch((error) => {
      if (active) setState({ status: "error", value: null, message: error instanceof Error ? error.message : "Could not load a recommendation" });
    });
    return () => { active = false; };
  }, [user.id]);

  if (state.status === "loading") return <ConnectedLoading label="Checking for a recommendation…" />;
  if (state.status === "error" || !state.value) {
    return <div className="home-assistant-empty"><span aria-hidden="true">♥</span><div><strong>Ready when you are, {user.fullName.split(/\s+/)[0]}</strong><p>Tell Senior Quest what would feel helpful or enjoyable today.</p></div><Link className="primary-button" href="/messages?assistant=1">Start a conversation</Link></div>;
  }
  return <EngineQuestCard run={state.value} compact />;
}

export function EngineQuestDetail({ runId, showActivityActions = true }: { runId: string; showActivityActions?: boolean }) {
  const { user } = useUser();
  const [state, setState] = useState<LoadState<QuestRun | null>>({ status: "loading", value: null });
  useEffect(() => {
    let active = true;
    void getQuestRun(runId).then((run) => {
      if (active) setState({ status: "ready", value: run });
    }).catch((error) => {
      if (active) setState({ status: "error", value: null, message: error instanceof Error ? error.message : "Could not load this quest" });
    });
    return () => { active = false; };
  }, [runId]);

  if (state.status === "loading") return <ConnectedLoading label="Loading quest details…" />;
  if (state.status === "error") return <ConnectedError message={state.message} />;
  const run = state.value;
  const proposal = run?.proposal;
  if (!run) return <ConnectedError message="This quest could not be found." />;
  if (!proposal) {
    return <ConnectedError message={run.status === "failed" ? "This recommendation could not be completed. Please ask Senior Quest to try again." : "This quest is still being prepared."} />;
  }

  const venueRequirements = proposal.quest.venueRequirements.length > 0
    ? proposal.quest.venueRequirements.map((item) => item.replaceAll("_", " ")).join(", ")
    : "Venue to be confirmed";

  return (
    <div className={`detail-page engine-detail-page${showActivityActions ? "" : " without-action"}`}>
      <div className="detail-header-wrap"><header className="page-header"><Link className="icon-button" href="/quests" aria-label="Back to quests"><Icon name="back" /></Link><h1>Quest Details</h1><span /></header></div>
      <div className="detail-layout">
        <div className="detail-image"><Image src={questImage(run)} alt="" fill priority sizes="(max-width: 767px) 100vw, 55vw" /><span className="image-badge">{run.status === "human_review" ? "Needs review" : "Recommended"}</span></div>
        <article className="detail-content">
          <h1>{proposal.quest.title}</h1>
          <p className="detail-description">{proposal.quest.description}</p>
          <div className="detail-facts">
            <div className="detail-fact"><Icon name="calendar" /><span><small>Date and time</small><strong>{questDate(run)}</strong></span></div>
            <div className="detail-fact"><Icon name="clock" /><span><small>Duration</small><strong>About {proposal.quest.durationMinutes} minutes</strong></span></div>
            <div className="detail-fact"><Icon name="pin" /><span><small>Venue requirements</small><strong>{venueRequirements}</strong></span></div>
            <div className="detail-fact"><Icon name="people" /><span><small>Group size</small><strong>{proposal.quest.groupSize} people</strong></span></div>
          </div>
          <section className="engine-participants"><h2>Everyone has a role</h2>{proposal.proposedParticipants.map((participant) => <div key={participant.candidateId}><span>{participant.candidateId === user.id ? "You" : participant.candidateId.replace("demo_", "").replace(/^./, (letter) => letter.toUpperCase())}</span><strong>{participant.proposedRole.replaceAll("_", " ")}</strong></div>)}</section>
          <section className="engine-assurance">
            <h2>Checks and coordination</h2>
            <div><strong>Constraints</strong><span>{run.validation?.valid ? "All participant constraints validated" : "Coordinator review required"}</span></div>
            {run.validation?.errors.length ? <ul>{run.validation.errors.map((error) => <li key={`${error.candidateId ?? "quest"}-${error.field}-${error.message}`}>{error.message}</li>)}</ul> : null}
            <div><strong>Safety</strong><span>{run.safety ? `${run.safety.status.replace("_", " ")} · ${run.safety.riskLevel} risk` : "Not yet reviewed"}</span></div>
            {run.safety?.conditions.length ? <ul>{run.safety.conditions.map((condition) => <li key={condition}>{condition}</li>)}</ul> : null}
          </section>
          {run.status === "human_review" ? <p className="assistant-note">A coordinator needs to review this match before any invitation is prepared.</p> : <p className="engine-safety"><Icon name="shield" size={20} /> Demo coordination only: safety approved and invitations prepared; no real messages were sent.</p>}
          {showActivityActions ? <div className="detail-action"><ActivityActions activityId={run.runId} /></div> : null}
        </article>
      </div>
    </div>
  );
}

function ConnectedLoading({ label }: { label: string }) {
  return <div className="connected-state" role="status"><span className="connected-spinner" />{label}</div>;
}

function ConnectedError({ message }: { message: string }) {
  return <div className="connected-state error" role="alert"><Icon name="shield" /><strong>{message}</strong><Link href="/messages?assistant=1">Talk to Senior Quest</Link></div>;
}
