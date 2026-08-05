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
import type { Participant, QuestRun } from "@/server/domain/schemas";
import { useUser } from "@/components/user-context";
import { useAppState } from "@/components/app-state";
import { ProfileAvatar } from "@/components/profile-avatar";
import { isQuestPast, isQuestRunPast } from "@/lib/activity-time";
import { questParticipantStatus } from "@/lib/quest-participant-status";
import { canSeeDemoContent } from "@/lib/demo-access";
import { activityLabel, participantCountLabel } from "@/lib/activity-label";

type LoadState<T> =
  | { status: "loading"; value: T }
  | { status: "ready"; value: T }
  | { status: "error"; value: T; message: string };

export function EngineQuestList() {
  const { user } = useUser();
  const { activityDecisions } = useAppState();
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
  const visibleRuns = state.value.filter((run) => run.proposal !== null && !isQuestRunPast(run) && activityDecisions[run.runId] !== "accepted");
  const visibleMockQuests = canSeeDemoContent(user)
    ? quests.filter((quest) => !isQuestPast(quest) && activityDecisions[quest.slug] !== "accepted")
    : [];
  if (visibleRuns.length === 0) {
    return visibleMockQuests.length > 0
      ? <section className="quest-grid" aria-label="Featured activities">{visibleMockQuests.map((quest) => <QuestCard key={quest.slug} quest={quest} />)}</section>
      : <div className="empty-state"><span aria-hidden="true">✓</span><h2>All caught up</h2><p>New activity suggestions will appear here when they are ready.</p></div>;
  }
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
  const invitationStatus = run.coordination?.invitations.find((invitation) => invitation.candidateId === user.id)?.status;
  // The roster/proposal is the source of truth for people who are actually in
  // this quest. Never use the requested group-size target as a participant
  // count: a target of three with only two matched people is still two people.
  const participants = questDetailParticipants(run);
  const participantCount = participants.length;
  const canRespond = showActivityActions && run.status === "awaiting_acceptance" && invitationStatus === "pending";
  const hasDecision = invitationStatus === "accepted" || invitationStatus === "declined";

  return (
    <div className={`detail-page engine-detail-page quest-detail-ref${showActivityActions ? "" : " without-action"}`}>
      <div className="detail-header-wrap"><header className="page-header"><Link className="detail-back-link" href="/quests" aria-label="Back to quests"><Icon name="back" /><span>Back to Quests</span></Link><h1>Quest Details</h1><button className="icon-button" type="button" aria-label="Save quest"><Icon name="heart" size={22} /></button></header></div>
      <section className="quest-detail-hero">
        <div className="quest-detail-hero-image"><Image src={questImage(run)} alt="" fill priority sizes="(max-width: 767px) 100vw, 55vw" />{run.status === "human_review" && <span className="image-badge">Needs review</span>}<span className="quest-image-label"><Icon name="home" size={15} /> {activityLabel(proposal.quest.questType)}</span></div>
        <div className="quest-detail-hero-copy">
          <span className="quest-status-pill"><Icon name="check" size={16} /> {run.status === "human_review" ? "Needs review" : "New"}</span>
          <h1>{proposal.quest.title}</h1>
          <p className="detail-description">{proposal.quest.description}</p>
          <div className="detail-facts quest-hero-facts">
            <div className="detail-fact"><Icon name="calendar" /><span><small>Date and time</small><strong>{questDate(run)}</strong></span></div>
            <div className="detail-fact"><Icon name="clock" /><span><small>Duration</small><strong>About {proposal.quest.durationMinutes} minutes</strong></span></div>
            <div className="detail-fact"><Icon name="pin" /><span><small>Venue requirements</small><strong>{venueRequirements}</strong></span></div>
            <div className="detail-fact"><Icon name="people" /><span><small>Group size</small><strong>{participantCountLabel(participantCount)}</strong></span></div>
          </div>
        </div>
      </section>
      <article className="detail-content quest-detail-content">
          <section className="engine-participants quest-participants" id="participants"><h2>Everyone has a role</h2><p className="participant-count">{participantCountLabel(participantCount)}</p>{participants.map((participant) => {
            const profile = run.participantProfiles?.find((candidate) => candidate.candidateId === participant.candidateId);
            const name = profile?.displayName ?? participantLabel(participant.candidateId, user.id);
            const status = questParticipantStatus(
              participant.candidateId,
              user.id,
              run.coordination?.invitations.find((invitation) => invitation.candidateId === participant.candidateId)?.status,
            );
            return <div className="engine-participant" key={participant.candidateId}><ProfileAvatar name={name} photoUrl={profile?.photoUrl} size={44} /><span className="engine-participant-name"><strong>{name}</strong><small>{participant.proposedRole.replaceAll("_", " ")}</small></span><span className={`participant-status participant-status-${status.key}`}>{status.label}</span></div>;
          })}</section>
          <section className="engine-assurance">
            <h2>Checks and coordination</h2>
            <div><strong>Constraints</strong><span>{run.validation?.valid ? "All participant constraints validated" : "Coordinator review required"}</span></div>
            {run.validation?.errors.length ? <ul>{run.validation.errors.map((error) => <li key={`${error.candidateId ?? "quest"}-${error.field}-${error.message}`}>{error.message}</li>)}</ul> : null}
            <div><strong>Safety</strong><span>{run.safety ? `${run.safety.status.replace("_", " ")} · ${run.safety.riskLevel} risk` : "Not yet reviewed"}</span></div>
            {run.safety?.conditions.length ? <ul>{run.safety.conditions.map((condition) => <li key={condition}>{condition}</li>)}</ul> : null}
          </section>
          {run.status === "human_review" ? <p className="assistant-note">A coordinator needs to review this match before any invitation is prepared.</p> : <p className="engine-safety"><Icon name="shield" size={20} /> Safety checks passed; invitations are ready for the participants.</p>}
          {canRespond || hasDecision ? <div className="detail-action"><ActivityActions activityId={run.runId} initialDecision={hasDecision ? invitationStatus : undefined} onDecision={(decision) => setState((current) => current.status !== "ready" || !current.value?.coordination ? current : { ...current, value: { ...current.value, coordination: { ...current.value.coordination, invitations: current.value.coordination.invitations.map((invitation) => invitation.candidateId === user.id ? { ...invitation, status: decision } : invitation) } } })} /></div> : null}
      </article>
    </div>
  );
}

function ConnectedLoading({ label }: { label: string }) {
  return <div className="connected-state" role="status"><span className="connected-spinner" />{label}</div>;
}

function ConnectedError({ message }: { message: string }) {
  return <div className="connected-state error" role="alert"><Icon name="shield" /><strong>{message}</strong><Link href="/messages?assistant=1">Talk to Senior Quest</Link></div>;
}

function questDetailParticipants(run: QuestRun): Participant[] {
  if (!run.proposal) return [];
  const participants = [...run.proposal.proposedParticipants];
  for (const invitation of run.coordination?.invitations ?? []) {
    if (participants.some((participant) => participant.candidateId === invitation.candidateId)) continue;
    participants.push({
      candidateId: invitation.candidateId,
      proposedRole: "supporting_participant",
      needsAddressed: [],
      contributionsUsed: [],
    });
  }
  return participants;
}

function participantLabel(candidateId: string, currentUserId: string): string {
  if (candidateId === currentUserId) return "You";
  const demoNames: Record<string, string> = {
    demo_anne: "Anne",
    demo_david: "David",
    demo_john: "John",
    demo_mei: "Mei",
  };
  return demoNames[candidateId] ?? (candidateId.startsWith("demo_") ? "Community neighbour" : "Community member");
}
