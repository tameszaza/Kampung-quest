"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getRewardSummary } from "@/features/rewards/client";
import type { RewardEligibility, RewardOffer, RewardSummary, UsableReward } from "@/server/features/reward-service";

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
        <div className="rewards-earned"><b>{summary.approvedTaskCount}</b><span>approved {summary.approvedTaskCount === 1 ? "task" : "tasks"}</span></div>
      </section>

      <section className="rewards-how" aria-label="How points work">
        <span><Icon name="check" size={22} /></span>
        <div><strong>Complete a task</strong><small>Your event admin reviews each task before points are added.</small></div>
        {summary.pointsUntilNextReward > 0 ? <b>{summary.pointsUntilNextReward} points to your next reward</b> : <b>Choose an available reward below</b>}
      </section>

      <section className="usable-rewards" aria-labelledby="usable-rewards-title">
        <div className="rewards-heading"><div><p>Your rewards</p><h2 id="usable-rewards-title">Usable codes</h2></div></div>
        {summary.usableRewards.length ? <UsableRewardList rewards={summary.usableRewards} /> : <div className="usable-rewards-empty"><Icon name="gift" size={22} /><span><strong>Your redeemed codes will appear here</strong><small>Choose a partner reward when you have enough points. Codes stay here until they are used or expire.</small></span></div>}
      </section>

      <div className="rewards-heading">
        <div><p>Community partner rewards</p><h2>Deals for your points</h2></div>
        <Link href="/partners">For companies <Icon name="chevron" size={17} /></Link>
      </div>
      <p className="rewards-preview-note"><Icon name="help" size={18} /> Use your points for one of these community partner rewards. Each code has its own expiry and terms.</p>
      <section className="reward-offer-grid" aria-label="Reward offers">
        {summary.offers.map((offer) => <RewardOfferCard key={offer.offerId} offer={offer} balance={summary.balance} />)}
      </section>

      <section className="reward-history" aria-labelledby="reward-history-title">
        <div className="rewards-heading"><div><p>Your progress</p><h2 id="reward-history-title">Points history</h2></div></div>
        {summary.history.length ? <ul>{summary.history.map((item) => <li key={item.earningId}><span><Icon name={item.kind === "redemption" ? "gift" : "badge"} size={20} /><span>{item.redemptionId ? <Link className="reward-history-link" href={`/rewards/redemptions/${item.redemptionId}`}><strong>{item.title}</strong></Link> : <strong>{item.title}</strong>}<small>{item.subtitle}</small></span></span><b className={item.points < 0 ? "reward-history-value--debit" : "reward-history-value--credit"} aria-label={`${item.points < 0 ? "Spent" : "Earned"} ${Math.abs(item.points)} points`}>{item.points >= 0 ? "+" : "−"}{Math.abs(item.points)}</b></li>)}</ul> : <div className="reward-history-empty"><span aria-hidden="true">✨</span><div><strong>Your first points are waiting</strong><small>Complete a task and ask the event admin to review it.</small></div><Link className="secondary-button" href="/quests">Find an activity</Link></div>}
      </section>
    </> : null}
  </div>;
}

function RewardOfferCard({ offer, balance }: { offer: RewardOffer; balance: number }) {
  const eligibility = offer.eligibility ?? fallbackEligibility(offer, balance);
  const statusText = eligibilityText(eligibility);
  return <article className="reward-offer-card">
    <div className={`reward-company-mark reward-company-${offer.tone}`} aria-hidden="true">{offer.initials}</div>
    <span className="reward-category">{offer.category}</span>
    <h3>{offer.title}</h3>
    <p>{offer.description}</p>
    <div className="reward-offer-footer"><span><Icon name="gift" size={18} /><strong>{offer.pointsCost}</strong> points</span><Link className="secondary-button reward-more-link" href={`/rewards/${offer.offerId}`}>More details <Icon name="chevron" size={16} /></Link></div>
    <span className={`reward-offer-status reward-offer-status--${eligibility.status}`}>{statusText}</span>
    <span className="sr-only">{statusText}</span>
  </article>;
}

function UsableRewardList({ rewards }: { rewards: UsableReward[] }) {
  return <ul className="usable-rewards-list">{rewards.map((reward) => <li key={reward.redemptionId}>
    <span className="usable-reward-icon"><Icon name="gift" size={19} /></span>
    <span className="usable-reward-copy"><strong>{reward.company} · {reward.title}</strong><small>{reward.maskedCode} · Issued · valid until {formatRewardDate(reward.effectiveExpiresAt)}</small></span>
    <Link className="secondary-button" href={`/rewards/redemptions/${reward.redemptionId}`}>View code <Icon name="chevron" size={16} /></Link>
  </li>)}</ul>;
}

function fallbackEligibility(offer: RewardOffer, balance: number): RewardEligibility {
  if (offer.status && offer.status !== "active") return { status: "paused" };
  if (offer.validUntilAt && Date.parse(offer.validUntilAt) <= Date.now()) return { status: "ended" };
  if (balance < offer.pointsCost) return { status: "insufficient_points", pointsNeeded: offer.pointsCost - balance };
  return { status: "eligible", balanceAfter: balance - offer.pointsCost };
}

function eligibilityText(eligibility: RewardEligibility): string {
  switch (eligibility.status) {
    case "eligible": return "Available to redeem";
    case "insufficient_points": return `Need ${eligibility.pointsNeeded} more points`;
    case "out_of_stock": return "Currently unavailable";
    case "not_started": return `Available from ${formatRewardDate(eligibility.startsAt)}`;
    case "ended": return "Offer ended";
    case "paused": return "Currently unavailable";
    case "limit_reached": return "Already redeemed";
  }
}

function formatRewardDate(value: string): string {
  return new Intl.DateTimeFormat("en-SG", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Singapore" }).format(new Date(value));
}
