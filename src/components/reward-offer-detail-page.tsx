"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { createClientRequestId } from "@/lib/client-request-id";
import { redeemReward } from "@/features/rewards/client";
import type { RewardOffer } from "@/server/features/reward-service";
import type { RewardRedemptionResult } from "@/server/features/reward-redemption-service";

export function RewardOfferDetailPage({ initialOffer }: { initialOffer: RewardOffer }) {
  const [offer, setOffer] = useState(initialOffer);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RewardRedemptionResult | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const redeemTriggerRef = useRef<HTMLButtonElement | null>(null);
  const eligibility = offer.eligibility;
  const eligible = eligibility?.status === "eligible";

  useEffect(() => {
    if (!dialogOpen) return;
    const dialog = dialogRef.current;
    const previousFocus = redeemTriggerRef.current ?? document.activeElement as HTMLElement | null;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [])];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialogOpen(false);
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [dialogOpen]);

  async function confirmRedemption() {
    if (!eligible || pending) return;
    setPending(true);
    setError("");
    idempotencyKey.current ??= createClientRequestId();
    try {
      const redeemed = await redeemReward(offer.offerId, idempotencyKey.current);
      setResult(redeemed);
      const nextOffer = redeemed.rewards.offers.find((candidate) => candidate.offerId === offer.offerId);
      if (nextOffer) setOffer(nextOffer);
      setDialogOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This reward could not be redeemed. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      setError("The code could not be copied. Please select and copy it manually.");
    }
  }

  return <div className={`page-container reward-detail-page reward-detail-${offer.tone}`}>
    <PageHeader title="Deal details" back backHref="/rewards" />

    <section className="reward-detail-hero" aria-labelledby="reward-detail-title">
      <div className="reward-detail-visual">
        {offer.heroImage ? <Image className="reward-detail-hero-image" src={offer.heroImage} alt={`${offer.company} reward`} fill priority sizes="(max-width: 900px) 100vw, 360px" /> : null}
        {offer.partnerLogoImage ? <Image className="reward-detail-logo-image" src={offer.partnerLogoImage} alt={`${offer.company} logo`} width={112} height={132} /> : <span className="reward-company-mark">{offer.initials}</span>}
        <span className="reward-detail-spark reward-detail-spark-one" aria-hidden="true" />
        <span className="reward-detail-spark reward-detail-spark-two" aria-hidden="true" />
      </div>
      <div className="reward-detail-intro">
        <span className="reward-category">Community partner reward</span>
        <h1 id="reward-detail-title">{offer.company}</h1>
        <h2>{offer.title}</h2>
        <p>{offer.description}</p>
        {offer.partnerBadgeImage ? <Image className="reward-detail-partner-badge-image" src={offer.partnerBadgeImage} alt="Official partner" width={174} height={48} /> : <span className="reward-detail-partner-badge"><Icon name="check" size={16} /> Official partner</span>}
      </div>
      <dl className="reward-detail-facts">
        <div><dt><Icon name="gift" size={18} /> Offer</dt><dd>{offer.value}</dd></div>
        <div><dt><Icon name="calendar" size={18} /> Valid until</dt><dd>{offer.validUntil}</dd></div>
        <div><dt><Icon name="pin" size={18} /> Locations</dt><dd>{offer.locations}</dd></div>
        <div><dt><Icon name="people" size={18} /> Eligibility</dt><dd>Senior Quest members</dd></div>
      </dl>
    </section>

    <div className="reward-detail-content">
      <section className="reward-detail-benefit" aria-labelledby="reward-benefit-title">
        <span className="reward-detail-icon"><Icon name="gift" size={25} /></span>
        <div><span className="reward-category">What you get</span><h2 id="reward-benefit-title">{offer.value}</h2><p>{offer.description}</p><strong>Worth up to the listed offer value</strong></div>
      </section>

      <section className="reward-detail-steps" aria-labelledby="reward-steps-title">
        <span className="reward-category">How it works</span>
        <h2 id="reward-steps-title">Turn your activity into a small treat</h2>
        <ol>{offer.redemptionSteps.map((step, index) => <li key={step}><b>{index + 1}</b><span>{step}</span></li>)}</ol>
        <p className="reward-detail-note">Your points are exchanged only after you confirm. Show the issued code to the participating partner before it expires.</p>
      </section>

      <aside className="reward-detail-about" aria-labelledby="reward-about-title">
        <span className="reward-category">About the partner</span>
        <h2 id="reward-about-title">{offer.company}</h2>
        <p>{offer.partnerDescription}</p>
        <ul><li><Icon name="pin" size={17} /> {offer.locations}</li><li><Icon name="clock" size={17} /> Check outlet hours before visiting</li><li><Icon name="shield" size={17} /> Accessible, community-minded offer</li></ul>
        <Link className="secondary-button" href="/rewards">Back to deals</Link>
      </aside>

      {offer.outletImage ? <section className="reward-detail-outlets" aria-labelledby="reward-outlets-title"><div><span className="reward-category">Participating outlets</span><h2 id="reward-outlets-title">Find a welcoming place to enjoy it</h2><p>Check the participating outlet and its opening hours before visiting.</p></div><Image src={offer.outletImage} alt={`${offer.company} outlet`} width={506} height={263} /></section> : null}
    </div>

    {offer.menuImages?.length ? <section className="reward-detail-gallery" aria-label="Example menu items">{offer.menuImages.map((image, index) => <Image key={image} src={image} alt={`${offer.company} menu example ${index + 1}`} width={325} height={230} />)}</section> : null}

    {result ? <section className="reward-redemption-success" aria-live="polite"><span className="reward-redemption-success-icon"><Icon name="check" size={26} /></span><div><span className="reward-category">Reward code issued</span><h2>{result.redemption.title}</h2><p>Show this code to {result.redemption.company} before {formatDate(result.redemption.effectiveExpiresAt)}.</p><code>{result.redemption.code}</code><button className="secondary-button" type="button" onClick={() => void copyCode(result.redemption.code)}>Copy code</button><small>{result.redemption.terms}</small></div><Link className="secondary-button" href="/rewards">View all my rewards</Link></section> : null}
    {error ? <div className="connected-state error" role="alert"><Icon name="shield" />{error}</div> : null}
    <section className="reward-detail-footer"><span>{offer.rewardBadgeImage ? <Image src={offer.rewardBadgeImage} alt="Reward unlocked" width={54} height={50} /> : <Icon name="badge" size={24} />}<span><strong>{eligible ? `${offer.pointsCost} points` : eligibilityText(eligibility)}</strong><small>{eligible && eligibility?.status === "eligible" ? `${eligibility.balanceAfter} points left after redemption.` : "Complete more activities to unlock this reward."}</small></span></span><button ref={redeemTriggerRef} className="primary-button" type="button" disabled={!eligible || pending} onClick={() => setDialogOpen(true)}>{pending ? "Redeeming…" : eligible ? `Redeem for ${offer.pointsCost} points` : eligibilityText(eligibility)}</button></section>
    {dialogOpen ? <div className="reward-dialog-backdrop" role="presentation"><section className="reward-dialog" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="redeem-dialog-title"><button className="reward-dialog-close" type="button" aria-label="Close confirmation" onClick={() => setDialogOpen(false)}>×</button><span className="reward-category">Confirm redemption</span><h2 id="redeem-dialog-title">Spend {offer.pointsCost} points on {offer.title}?</h2><p>You will have {eligibility?.status === "eligible" ? eligibility.balanceAfter : 0} points left. Your code cannot be returned after it is issued.</p><div className="reward-dialog-actions"><button className="secondary-button" type="button" onClick={() => setDialogOpen(false)} disabled={pending}>Cancel</button><button className="primary-button" type="button" onClick={() => void confirmRedemption()} disabled={pending}>{pending ? "Redeeming…" : "Confirm redemption"}</button></div></section></div> : null}
  </div>;
}

function eligibilityText(eligibility: RewardOffer["eligibility"]): string {
  if (!eligibility) return "Redemption unavailable";
  switch (eligibility.status) {
    case "eligible": return "Available to redeem";
    case "insufficient_points": return `Need ${eligibility.pointsNeeded} more points`;
    case "out_of_stock": return "Currently unavailable";
    case "not_started": return `Available from ${formatDate(eligibility.startsAt)}`;
    case "ended": return "Offer ended";
    case "paused": return "Currently unavailable";
    case "limit_reached": return "Already redeemed";
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-SG", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Singapore" }).format(new Date(value));
}
