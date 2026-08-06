"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { ProfileAvatar } from "@/components/profile-avatar";
import { listUserNotifications } from "@/features/assistant/client";
import type { EventNotificationView, UserEventActivities } from "@/server/domain/event-coordination";
import type { QuestNotification } from "@/server/quest/quest-notifications";

type ActivityNotification = QuestNotification | EventNotificationView;

export function ActivityNotifications({ activities }: { activities?: UserEventActivities | null }) {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; items: QuestNotification[] }>({
    status: "loading",
    items: [],
  });

  useEffect(() => {
    let active = true;
    void listUserNotifications().then((items) => {
      if (active) setState({ status: "ready", items });
    }).catch(() => {
      if (active) setState({ status: "error", items: [] });
    });
    return () => { active = false; };
  }, [reloadToken]);

  if (state.status === "loading") return <div className="connected-state" role="status"><span className="connected-spinner" />Loading notifications…</div>;
  if (state.status === "error") return <div className="connected-state error" role="alert"><Icon name="shield" /><strong>Notifications could not load.</strong><button className="secondary-button" type="button" onClick={() => { setState({ status: "loading", items: [] }); setReloadToken((token) => token + 1); }}>Try again</button></div>;
  const items: ActivityNotification[] = [...state.items, ...(activities?.notifications ?? [])]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  if (items.length === 0) {
    return <div className="empty-state activity-notifications-empty"><span><Icon name="bell" size={32} /></span><h2>You’re all caught up</h2><p>Suggestions, invitations, and activity updates will appear here.</p></div>;
  }

  return (
    <section className="activity-notifications" aria-label="Activity notifications">
      {items.map((item) => (
        <article className={`activity-notification activity-notification-${item.kind}`} key={"id" in item ? item.id : item.notificationId}>
          {"actor" in item && item.actor ? <ProfileAvatar name={item.actor.displayName} photoUrl={item.actor.photoUrl} size={46} /> : <span className="activity-notification-icon" aria-hidden="true"><Icon name={iconFor(item.kind)} size={22} /></span>}
          <div className="activity-notification-content">
            <div className="activity-notification-heading"><h2>{item.title}</h2><time dateTime={item.createdAt}>{formatNotificationTime(item.createdAt)}</time></div>
            <p>{"message" in item ? item.message : item.body}</p>
            <Link href={`/quests/${encodeURIComponent("questRunId" in item ? item.questRunId : item.runId)}`}>View activity <span aria-hidden="true">→</span></Link>
          </div>
        </article>
      ))}
    </section>
  );
}

function iconFor(kind: ActivityNotification["kind"]): "bell" | "calendar" | "close" | "message" | "shield" {
  if (kind === "joined") return "calendar";
  if (kind === "declined") return "close";
  if (kind === "status") return "shield";
  if (kind === "group_message") return "message";
  return "bell";
}

function formatNotificationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}
