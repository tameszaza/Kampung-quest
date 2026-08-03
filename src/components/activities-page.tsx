"use client";

import { useState } from "react";
import { EngineQuestList } from "@/components/engine-quest-views";
import { InviteList } from "@/components/invite-list";
import { PageHeader } from "@/components/page-header";
import { Tabs } from "@/components/tabs";
import { useUser } from "@/components/user-context";

export function ActivitiesPage({ initialTab = "Suggested" }: { initialTab?: "Suggested" | "Invited" }) {
  const [tab, setTab] = useState<"Suggested" | "Invited">(initialTab);
  const { user } = useUser();
  const firstName = user.fullName.split(/\s+/)[0] || user.fullName;

  return (
    <div className="page-container">
      <PageHeader title="Activities" />
      <Tabs tabs={["Suggested", "Invited"]} active={tab} onChange={(value) => setTab(value as "Suggested" | "Invited")} />
      {tab === "Invited" ? (
        <InviteList />
      ) : (
        <>
          <p className="matched-copy">Safely matched for {firstName} <span aria-hidden="true">✨</span></p>
          <EngineQuestList />
        </>
      )}
    </div>
  );
}
