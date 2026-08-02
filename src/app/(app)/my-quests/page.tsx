"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { AvatarStack } from "@/components/avatar-stack";
import { Icon } from "@/components/icons";
import { MetaRow } from "@/components/meta-row";
import { PageHeader } from "@/components/page-header";
import { Tabs } from "@/components/tabs";
import { quests } from "@/data/mock-data";

export default function MyQuestsPage() {
  const [tab, setTab] = useState("Upcoming");
  const visibleQuests = tab === "Upcoming" ? [quests[0], quests[2]] : [quests[1]];

  return (
    <div className="page-container narrow-page">
      <PageHeader title="My Activities" />
      <Tabs tabs={["Upcoming", "Past"]} active={tab} onChange={setTab} />
      <section className="joined-list">
        {visibleQuests.map((quest) => (
          <Link className="joined-card" href={`/quests/${quest.slug}`} key={quest.slug}>
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
      </section>
    </div>
  );
}
