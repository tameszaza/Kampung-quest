"use client";

import Image from "next/image";
import Link from "next/link";
import { useAppState } from "@/components/app-state";
import { ActivityActions } from "@/components/activity-actions";
import { Icon } from "@/components/icons";
import { MetaRow } from "@/components/meta-row";
import type { Quest } from "@/types/quest";

export function QuestCard({ quest, compact = false }: { quest: Quest; compact?: boolean }) {
  const { savedQuests, toggleSaved } = useAppState();
  const saved = savedQuests.has(quest.slug);

  return (
    <article className={`quest-card${compact ? " compact" : ""}`}>
      <Link className="quest-card-link" href={`/quests/${quest.slug}`}>
        <div className="quest-card-image">
          <Image src={quest.image} alt="" fill sizes="(max-width: 767px) 100vw, 420px" />
          {quest.badge ? <span className="image-badge">{quest.badge}</span> : null}
        </div>
        <div className="quest-card-body">
          <h2>{quest.title}</h2>
          <MetaRow icon="people">{quest.people}</MetaRow>
          <MetaRow icon="calendar">{quest.dateLabel}, {quest.time.split(" – ")[0]}</MetaRow>
          <MetaRow icon="pin">{quest.setting}</MetaRow>
        </div>
      </Link>
      <button
        className={`save-button${saved ? " saved" : ""}`}
        type="button"
        aria-label={saved ? "Remove from saved quests" : "Save quest"}
        aria-pressed={saved}
        onClick={() => toggleSaved(quest.slug)}
      >
        <Icon name="heart" size={23} />
      </button>
      <ActivityActions activityId={quest.slug} />
    </article>
  );
}
