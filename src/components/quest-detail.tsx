"use client";

import Image from "next/image";
import { useAppState } from "@/components/app-state";
import { ActivityActions } from "@/components/activity-actions";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import type { Quest } from "@/types/quest";

export function QuestDetail({ quest, showActivityActions = true, backHref = "/quests" }: { quest: Quest; showActivityActions?: boolean; backHref?: string }) {
  const { showToast } = useAppState();

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: quest.title, url: window.location.href });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        showToast("Quest link copied");
      }
    } catch {
      // Cancelling the native share sheet is not an error for the user.
    }
  }

  return (
    <div className={`detail-page${showActivityActions ? "" : " without-action"}`}>
      <div className="detail-header-wrap">
        <PageHeader
          title="Quest Details"
          back
          backHref={backHref}
          right={
            <button className="icon-button" type="button" onClick={share} aria-label="Share quest">
              <Icon name="share" size={22} />
            </button>
          }
        />
      </div>

      <div className="detail-layout">
        <div className="detail-image">
          <Image src={quest.image} alt="" fill priority sizes="(max-width: 767px) 100vw, 55vw" />
          {quest.badge ? <span className="image-badge">{quest.badge}</span> : null}
        </div>

        <article className="detail-content">
          <h1>{quest.title}</h1>
          <p className="detail-description">{quest.description}</p>

          <div className="detail-facts">
            <div className="detail-fact"><Icon name="calendar" /><span><small>Date</small><strong>{quest.dateLong}</strong></span></div>
            <div className="detail-fact"><Icon name="clock" /><span><small>Time</small><strong>{quest.time}</strong></span></div>
            <div className="detail-fact"><Icon name="pin" /><span><small>Location</small><strong>{quest.location}</strong></span></div>
            <div className="detail-fact"><Icon name="people" /><span><small>Group Size</small><strong>{quest.people}</strong></span></div>
            <div className="detail-fact host-fact">
              <span className="host-avatar"><Image src={quest.host.image} alt="" fill sizes="42px" /></span>
              <span><small>Host</small><strong>{quest.host.name}</strong></span>
            </div>
          </div>

          {showActivityActions ? <div className="detail-action"><ActivityActions activityId={quest.slug} /></div> : null}
        </article>
      </div>
    </div>
  );
}
