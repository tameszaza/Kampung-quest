"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getRewardSummary } from "@/features/rewards/client";
import type { RewardOffer, RewardSummary } from "@/server/features/reward-service";

export function RewardsPage() {
  const [summary, setSummary] = useState<RewardSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getRewardSummary().then((value) => {
      if (active) setSummary(value);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Rewards could not be loaded");
    });
    return () => { active = false; };
  }, []);

  return <div className="page-container rewards-page">
    <PageHeader title="Rewards" />
    {!summary && !error ? <div className="connected-state" role="status"><span className="connected-spinner" />Loading your points…</div> : null}
    {error ? <div className="connected-state error" role="alert"><Icon name="shield" />{error}</div> : null}
    {summary ? <>
      <section className="rewards-balance" aria-labelledby="rewards-balance-title">
        <span className="rewards-balance-icon" aria-hidden="true"><Icon name="gift" size={30} /></span>
        <div><p id="rewards-balance-title">Your Senior Quest points</p><strong>{summary.balance.toLocaleString()}</strong><small>points available</small></div>
        <div className="rewards-earned"><b>{summary.completedActivityCount}</b><span>completed {summary.completedActivityCount === 1 ? "activity" : "activities"}</span></div>
      </section>

      <section className="rewards-how" aria-label="How points work">
        <span><Icon name="check" size={22} /></span>
        <div><strong>Complete an activity</strong><small>Every completed activity earns {summary.pointsPerCompletedActivity} points automatically.</small></div>
        {summary.pointsUntilNextReward > 0 ? <b>{summary.pointsUntilNextReward} points to your next reward</b> : <b>You can preview available rewards</b>}
      </section>

      <div className="rewards-heading">
        <div><p>Community partner previews</p><h2>Deals for your points</h2></div>
        <Link href="/partners">For companies <Icon name="chevron" size={17} /></Link>
      </div>
      <p className="rewards-preview-note"><Icon name="help" size={18} /> These sample offers show how partner rewards will work. Redemption is not open yet.</p>
      <section className="reward-offer-grid" aria-label="Reward offer previews">
        {summary.offers.map((offer) => <RewardOfferCard key={offer.offerId} offer={offer} balance={summary.balance} />)}
      </section>

      <section className="reward-history" aria-labelledby="reward-history-title">
        <div className="rewards-heading"><div><p>Your progress</p><h2 id="reward-history-title">Points history</h2></div></div>
        {summary.earnings.length ? <ul>{summary.earnings.map((earning) => <li key={earning.runId}><span><Icon name="badge" size={20} /><span><strong>{earning.title}</strong><small>Activity completed</small></span></span><b>+{earning.points}</b></li>)}</ul> : <div className="reward-history-empty"><span aria-hidden="true">✨</span><div><strong>Your first points are waiting</strong><small>Complete a Senior Quest activity to earn {summary.pointsPerCompletedActivity} points.</small></div><Link className="secondary-button" href="/quests">Find an activity</Link></div>}
      </section>
    </> : null}
  </div>;
}

function RewardOfferCard({ offer, balance }: { offer: RewardOffer; balance: number }) {
  const affordable = balance >= offer.pointsCost;
  return <article className="reward-offer-card">
    <div className={`reward-company-mark reward-company-${offer.tone}`} aria-hidden="true">{offer.initials}</div>
    <span className="reward-category">{offer.category}</span>
    <h3>{offer.title}</h3>
    <p>{offer.description}</p>
    <div className="reward-offer-footer"><span><Icon name="gift" size={18} /><strong>{offer.pointsCost}</strong> points</span><Link className="secondary-button reward-more-link" href={`/rewards/${offer.offerId}`}>More details <Icon name="chevron" size={16} /></Link></div>
    <span className="sr-only">{affordable ? "You have enough points to preview this offer." : `You need ${offer.pointsCost - balance} more points to preview this offer.`}</span>
  </article>;
}
