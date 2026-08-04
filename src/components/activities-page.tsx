"use client";

import { useState } from "react";
import { EngineQuestList } from "@/components/engine-quest-views";
import { ActivityNotifications } from "@/components/activity-notifications";
import { InviteList } from "@/components/invite-list";
import { PageHeader } from "@/components/page-header";
import { Tabs } from "@/components/tabs";
import { useUser } from "@/components/user-context";

export function ActivitiesPage({ initialTab = "Suggested" }: { initialTab?: "Suggested" | "Invited" | "Notifications" }) {
  const [tab, setTab] = useState<"Suggested" | "Invited" | "Notifications">(initialTab);
  const { user } = useUser();
  const firstName = user.fullName.split(/\s+/)[0] || user.fullName;

  return (
    <div className="page-container">
      <PageHeader title="Activities" />
      <Tabs tabs={["Suggested", "Invited", "Notifications"]} active={tab} onChange={(value) => setTab(value as "Suggested" | "Invited" | "Notifications")} />
      {tab === "Invited" ? (
        <InviteList />
      ) : tab === "Notifications" ? (
        <ActivityNotifications />
      ) : (
        <>
          <p className="matched-copy">Safely matched for {firstName} <span aria-hidden="true">✨</span></p>
          <EngineQuestList />
        </>
      )}
    </div>
  );
}
