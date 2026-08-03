"use client";

import Image from "next/image";
import Link from "next/link";
import { ActivityActions } from "@/components/activity-actions";
import { useAppState } from "@/components/app-state";
import { Icon } from "@/components/icons";
import type { Quest } from "@/types/quest";

/** A wide-screen quest card that follows the desktop dashboard visual hierarchy. */
export function DesktopQuestCard({ quest }: { quest: Quest }) {
  const { savedQuests, toggleSaved } = useAppState();
  const saved = savedQuests.has(quest.slug);

  return (
    <article className="desktop-quest-card">
      <div className="desktop-quest-image">
        <Image src={quest.image} alt="" fill sizes="(min-width: 1024px) 30vw, 100vw" />
        {quest.badge ? <span className="image-badge">{quest.badge}</span> : null}
        <button
          className={`desktop-quest-save${saved ? " saved" : ""}`}
          type="button"
          aria-label={saved ? "Remove from saved quests" : "Save quest"}
          aria-pressed={saved}
          onClick={() => toggleSaved(quest.slug)}
        >
          <Icon name="heart" size={20} />
        </button>
      </div>
      <div className="desktop-quest-body">
        <h3>{quest.title}</h3>
        <p>{quest.description}</p>
        <div className="desktop-quest-facts" aria-label="Quest details">
          <span><Icon name="people" size={17} />{quest.people}</span>
          <span><Icon name="calendar" size={17} />{quest.dateLabel}</span>
          <span><Icon name="pin" size={17} />{quest.setting}</span>
        </div>
        <div className="desktop-quest-actions">
          <Link className="secondary-button" href={`/quests/${quest.slug}`}>View Details</Link>
          <ActivityActions activityId={quest.slug} acceptOnly />
        </div>
      </div>
    </article>
  );
}
