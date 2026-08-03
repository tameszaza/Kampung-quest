"use client";

import Image from "next/image";
import { useState } from "react";
import { useAppState } from "@/components/app-state";
import { Icon } from "@/components/icons";
import { MetaRow } from "@/components/meta-row";
import { Tabs } from "@/components/tabs";
import { getQuest, invites } from "@/data/mock-data";

/** Invitations are kept as a focused activity view so they can be surfaced
 * from Activities without creating a second, competing top-level destination. */
export function InviteList() {
  const [tab, setTab] = useState("Received");
  const { inviteDecisions, decideInvite } = useAppState();

  return (
    <>
      <p className="demo-page-note"><strong>Demo preview:</strong> these invitations are examples. Accepting or rejecting them does not message anyone.</p>
      <Tabs tabs={["Received", "Sent"]} active={tab} onChange={setTab} />

      {tab === "Sent" ? (
        <div className="empty-state">
          <span><Icon name="invite" size={34} /></span>
          <h2>No sent invites yet</h2>
          <p>Invitations you send will appear here.</p>
        </div>
      ) : (
        <section className="invite-list" aria-label="Activity invitations">
          {invites.map((invite) => {
            const quest = getQuest(invite.questSlug);
            if (!quest) return null;
            const decision = inviteDecisions[invite.id];
            return (
              <article className="invite-card" key={invite.id}>
                <div className="invite-image">
                  <Image src={quest.image} alt="" fill sizes="(max-width: 767px) 100vw, 460px" />
                  <span className="image-badge">New</span>
                </div>
                <h2>{quest.title}</h2>
                <MetaRow icon="profile">From {invite.from}</MetaRow>
                <MetaRow icon="calendar">{quest.dateLabel}, {quest.time.split(" – ")[0]}</MetaRow>

                {decision ? (
                  <div className={`decision-message ${decision}`}>
                    <Icon name={decision === "accepted" ? "check" : "close"} size={19} />
                    {decision === "accepted" ? "Invite accepted" : "Invite rejected"}
                  </div>
                ) : (
                  <div className="split-actions">
                    <button className="secondary-button" type="button" onClick={() => decideInvite(invite.id, "declined")}>Reject</button>
                    <button className="primary-button" type="button" onClick={() => decideInvite(invite.id, "accepted")}>Accept</button>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}
