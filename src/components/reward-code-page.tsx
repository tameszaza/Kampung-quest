"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import type { RewardRedemptionView } from "@/server/features/reward-redemption-service";

export function RewardCodePage({ redemption }: { redemption: RewardRedemptionView }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(redemption.code);
      setCopied(true);
      setError("");
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setError("The code could not be copied. Please select and copy it manually.");
    }
  }

  return <div className="page-container reward-code-page">
    <PageHeader title="Your reward code" back backHref="/rewards" />
    <section className="reward-code-card" aria-labelledby="reward-code-title">
      <span className="reward-redemption-success-icon"><Icon name="check" size={26} /></span>
      <span className="reward-category">Issued reward</span>
      <h1 id="reward-code-title">{redemption.title}</h1>
      <p className="reward-code-company">{redemption.company}</p>
      <div className="reward-code-value" aria-label={`Reward code ${redemption.code}`}>{redemption.code}</div>
      <button className="primary-button" type="button" onClick={() => void copyCode()}>{copied ? "Copied" : "Copy code"}</button>
      {error ? <p className="reward-code-error" role="alert">{error}</p> : null}
      <dl className="reward-code-facts"><div><dt>Valid until</dt><dd>{formatDate(redemption.effectiveExpiresAt)}</dd></div><div><dt>Where to use it</dt><dd>{redemption.locations}</dd></div><div><dt>What you get</dt><dd>{redemption.value}</dd></div></dl>
      <p className="reward-code-terms">{redemption.terms}</p>
      <p className="reward-code-instruction">Show this code to the participating partner. It cannot be returned after it is issued.</p>
      <Link className="secondary-button" href="/rewards">View all usable rewards</Link>
    </section>
  </div>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-SG", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Singapore" }).format(new Date(value));
}
