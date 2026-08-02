"use client";

import { useState } from "react";
import { useAppState } from "@/components/app-state";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Tabs } from "@/components/tabs";
import { activeNeeds, pastNeeds } from "@/data/mock-data";

export default function NeedsPage() {
  const [tab, setTab] = useState("Active");
  const { showToast } = useAppState();
  const needs = tab === "Active" ? activeNeeds : pastNeeds;

  return (
    <div className="page-container narrow-page">
      <PageHeader
        title="My Needs"
        back
        right={
          <button className="round-add" type="button" onClick={() => showToast("Add need form is ready for backend wiring")} aria-label="Add a need">
            <Icon name="plus" size={24} />
          </button>
        }
      />
      <Tabs tabs={["Active", "Past"]} active={tab} onChange={setTab} />
      <section className="need-list" aria-live="polite">
        {needs.map((need) => (
          <article className="need-card" key={need.id}>
            <span className="need-emoji" aria-hidden="true">{need.emoji}</span>
            <div>
              <h2>{need.title}</h2>
              <p>{need.preference}</p>
              <p>{need.schedule}</p>
              <strong>{need.status}</strong>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
