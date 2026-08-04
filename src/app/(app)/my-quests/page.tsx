"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AvatarStack } from "@/components/avatar-stack";
import { EngineJoinedQuestCard } from "@/components/engine-quest-card";
import { Icon } from "@/components/icons";
import { MetaRow } from "@/components/meta-row";
import { PageHeader } from "@/components/page-header";
import { Tabs } from "@/components/tabs";
import { useAppState } from "@/components/app-state";
import { invites, quests } from "@/data/mock-data";
import { listUserQuests } from "@/features/assistant/client";
import { isQuestPast, isQuestRunPast } from "@/lib/activity-time";
import { useUser } from "@/components/user-context";
import type { QuestRun } from "@/server/domain/schemas";
import { canSeeDemoContent } from "@/lib/demo-access";

export default function MyQuestsPage() {
  const [tab, setTab] = useState("Upcoming");
  const { activityDecisions, inviteDecisions } = useAppState();
  const { user } = useUser();
  const showDemo = canSeeDemoContent(user);
  const [engineRuns, setEngineRuns] = useState<QuestRun[]>([]);
  useEffect(() => {
    let active = true;
    void listUserQuests(user.id).then((runs) => {
      if (active) setEngineRuns(runs);
    }).catch(() => {
      // Demo activities remain available if the recommendation service is unavailable.
    });
    return () => { active = false; };
  }, [user.id]);
  const acceptedSlugs = new Set(showDemo ? [
    ...Object.entries(activityDecisions).filter(([, decision]) => decision === "accepted").map(([slug]) => slug),
    ...invites.filter((invite) => inviteDecisions[invite.id] === "accepted").map((invite) => invite.questSlug),
  ] : []);
  const acceptedQuests = showDemo ? quests.filter((quest) => acceptedSlugs.has(quest.slug)) : [];
  const demoUpcoming = showDemo ? [quests[0], quests[2]].filter((quest) => !isQuestPast(quest)) : [];
  // Keep the demo history honest: an activity is only past after its actual
  // start time, rather than because it happens to be the third fixture.
  const demoPast = showDemo ? [quests[1]].filter((quest) => isQuestPast(quest)) : [];
  const visibleQuests = tab === "Upcoming"
    ? uniqueQuests([...demoUpcoming, ...acceptedQuests.filter((quest) => !isQuestPast(quest))])
    : uniqueQuests([...demoPast, ...acceptedQuests.filter((quest) => isQuestPast(quest))]);
  const acceptedRuns = engineRuns.filter((run) => run.proposal && activityDecisions[run.runId] === "accepted");
  const visibleRuns = tab === "Upcoming"
    ? acceptedRuns.filter((run) => !isQuestRunPast(run))
    : acceptedRuns.filter((run) => isQuestRunPast(run));

  return (
    <div className="page-container narrow-page">
      <PageHeader title="My Activities" />
      <Tabs tabs={["Upcoming", "Past"]} active={tab} onChange={setTab} />
      <section className="joined-list">
        {visibleRuns.map((run) => <EngineJoinedQuestCard key={run.runId} run={run} />)}
        {visibleQuests.map((quest) => (
          <Link className="joined-card" href={`/quests/${quest.slug}?from=my-activities`} key={quest.slug}>
            <div className="joined-image">
              <Image src={quest.image} alt="" fill sizes="(max-width: 767px) 100vw, 460px" />
              <span className="image-badge">{tab === "Upcoming" ? "UPCOMING" : "COMPLETED"}</span>
            </div>
            <div className="joined-body">
              <h2>{quest.title}</h2>
              <MetaRow icon="calendar">{quest.dateLabel}, {quest.time.split(" – ")[0]}</MetaRow>
              <MetaRow icon="pin">{quest.location}</MetaRow>
              <div className="joined-footer">
                <AvatarStack count={Math.min(quest.joined ?? 3, 3)} />
                <span>{quest.joined} / {quest.capacity} joined</span>
                <Icon name="chevron" size={19} />
              </div>
            </div>
          </Link>
        ))}
        {!visibleRuns.length && !visibleQuests.length ? (
          <div className="joined-empty">
            <span aria-hidden="true">✓</span>
            <div>
              <h2>{tab === "Upcoming" ? "No upcoming activities" : "No past activities yet"}</h2>
              <p>{tab === "Upcoming" ? "Accepted activities will appear here." : "Completed activities will appear here after their start time."}</p>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function uniqueQuests(items: typeof quests) {
  return [...new Map(items.map((quest) => [quest.slug, quest])).values()];
}
