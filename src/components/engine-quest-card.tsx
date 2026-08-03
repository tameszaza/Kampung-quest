import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { ActivityActions } from "@/components/activity-actions";
import { isQuestRunPast } from "@/lib/activity-time";
import type { QuestRun } from "@/server/domain/schemas";

export function questImage(run: QuestRun) {
  const text = `${run.proposal?.quest.title ?? ""} ${run.proposal?.quest.description ?? ""}`.toLowerCase();
  if (text.includes("walk") || text.includes("exercise")) return "/assets/walk.jpg";
  if (text.includes("digital") || text.includes("phone") || text.includes("technology")) {
    return "/assets/digital-help.jpg";
  }
  return "/assets/cooking.jpg";
}

export function questDate(run: QuestRun) {
  const window = run.proposal?.quest.proposedTimeWindow;
  if (!window) return "Schedule to be confirmed";
  const start = new Date(window.start);
  return `${start.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  })}, ${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export function EngineQuestCard({ run, compact = false }: { run: QuestRun; compact?: boolean }) {
  const quest = run.proposal?.quest;
  if (!quest) return null;
  return (
    <article className={`quest-card engine-quest-card${compact ? " compact" : ""}`}>
      <Link className="quest-card-link" href={`/quests/${run.runId}`}>
        <div className="quest-card-image">
          <Image src={questImage(run)} alt="" fill sizes="(max-width: 767px) 100vw, 420px" />
          <span className={`image-badge quest-status-${run.status}`}>
            {run.status === "human_review" ? "Needs review" : "Recommended"}
          </span>
        </div>
        <div className="quest-card-body">
          <h2>{quest.title}</h2>
          <div className="meta-row"><Icon name="people" size={19} /><span>{quest.groupSize} people</span></div>
          <div className="meta-row"><Icon name="calendar" size={19} /><span>{questDate(run)}</span></div>
          <div className="meta-row"><Icon name="shield" size={19} /><span>{run.safety?.status === "approved" ? "Safety checked" : "Human review required"}</span></div>
        </div>
      </Link>
      <ActivityActions activityId={run.runId} />
    </article>
  );
}

/** Joined-activity presentation for accepted Senior Quest recommendations. */
export function EngineJoinedQuestCard({ run }: { run: QuestRun }) {
  const quest = run.proposal?.quest;
  if (!quest) return null;
  const start = new Date(quest.proposedTimeWindow.start);
  const date = start.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const time = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <Link className="joined-card" href={`/quests/${run.runId}?from=my-activities`}>
      <div className="joined-image">
        <Image src={questImage(run)} alt="" fill sizes="(max-width: 767px) 100vw, 460px" />
        <span className="image-badge">{isQuestRunPast(run) ? "COMPLETED" : "UPCOMING"}</span>
      </div>
      <div className="joined-body">
        <h2>{quest.title}</h2>
        <div className="meta-row"><Icon name="calendar" size={19} /><span>{date}, {time}</span></div>
        <div className="meta-row"><Icon name="people" size={19} /><span>{quest.groupSize} people</span></div>
        <div className="joined-footer"><span>Senior Quest match</span><Icon name="chevron" size={19} /></div>
      </div>
    </Link>
  );
}
