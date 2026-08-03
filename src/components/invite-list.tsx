"use client";

import Image from "next/image";
import { useState } from "react";
import { useAppState } from "@/components/app-state";
import { Icon } from "@/components/icons";
import { MetaRow } from "@/components/meta-row";
import { Tabs } from "@/components/tabs";
import { getQuest, invites } from "@/data/mock-data";
import { isQuestPast } from "@/lib/activity-time";

/** Invitations are kept as a focused activity view so they can be surfaced
 * from Activities without creating a second, competing top-level destination. */
export function InviteList() {
  const [tab, setTab] = useState("Received");
  const { inviteDecisions, decideInvite } = useAppState();
  const receivedInvites = invites.flatMap((invite) => {
    const quest = getQuest(invite.questSlug);
    if (!quest) return [];
    const decision = inviteDecisions[invite.id];
    // Accepted invitations move to My Activities; pending invitations
    // remain here after their start time so the user can see why they
    // are no longer actionable.
    if (decision === "accepted") return [];
    return [{ invite, quest, decision, expired: !decision && isQuestPast(quest) }];
  });

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
      ) : receivedInvites.length === 0 ? (
        <div className="empty-state">
          <span><Icon name="invite" size={34} /></span>
          <h2>No active invitations</h2>
          <p>Accepted invitations appear in My Activities.</p>
        </div>
      ) : (
        <section className="invite-list" aria-label="Activity invitations">
          {receivedInvites.map(({ invite, quest, decision, expired }) => {
            return (
              <article className="invite-card" key={invite.id}>
                <div className="invite-image">
                  <Image src={quest.image} alt="" fill sizes="(max-width: 767px) 100vw, 460px" />
                  <span className={`image-badge${expired ? " expired" : ""}`}>{expired ? "Expired" : "New"}</span>
                </div>
                <h2>{quest.title}</h2>
                <MetaRow icon="profile">From {invite.from}</MetaRow>
                <MetaRow icon="calendar">{quest.dateLabel}, {quest.time.split(" – ")[0]}</MetaRow>

                {expired ? (
                  <div className="decision-message expired">
                    <Icon name="clock" size={19} />
                    Invitation expired
                  </div>
                ) : decision ? (
                  <div className={`decision-message ${decision}`}>
                    <Icon name="close" size={19} />
                    Invite rejected
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
