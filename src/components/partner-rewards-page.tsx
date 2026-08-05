"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";

export function PartnerRewardsPage() {
  const [submitted, setSubmitted] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return <main className="partner-page">
    <header className="partner-nav">
      <Link className="partner-brand" href="/home"><span aria-hidden="true">♥</span>Senior Quest</Link>
      <Link className="secondary-button" href="/rewards">Member rewards</Link>
    </header>

    <section className="partner-hero">
      <div className="partner-hero-copy">
        <span className="partner-eyebrow"><Icon name="gift" size={18} /> Community rewards partners</span>
        <h1>Turn a simple offer into a meaningful local connection.</h1>
        <p>Help older adults stay active and connected by offering useful, accessible rewards through Senior Quest.</p>
        <a className="primary-button" href="#partner-form">Propose a reward</a>
        <small>Mock partner programme · no fees or commitments</small>
      </div>
      <div className="partner-hero-visual" aria-label="Example company reward card">
        <div className="partner-points-bubble"><Icon name="badge" size={20} /> Earned through community activities</div>
        <article><span className="reward-company-mark reward-company-mint">YC</span><small>Your Company</small><strong>A useful local reward</strong><p>Members exchange points earned by completing community activities.</p><b>500 points</b></article>
      </div>
    </section>

    <section className="partner-benefits" aria-labelledby="partner-benefits-title">
      <div className="partner-section-heading"><p>Why join</p><h2 id="partner-benefits-title">Good for members, communities, and local brands</h2></div>
      <div>
        <article><span><Icon name="people" /></span><h3>Reach active communities</h3><p>Meet members who are already participating in meaningful local activities.</p></article>
        <article><span><Icon name="heart" /></span><h3>Support healthy connection</h3><p>Make everyday wellbeing and social participation a little more rewarding.</p></article>
        <article><span><Icon name="badge" /></span><h3>Offer something practical</h3><p>Start with a clear voucher, product, experience, or accessible service.</p></article>
      </div>
    </section>

    <section className="partner-steps" aria-labelledby="partner-steps-title">
      <div className="partner-section-heading"><p>How it works</p><h2 id="partner-steps-title">A lightweight partner journey</h2></div>
      <ol><li><b>1</b><span><strong>Share your idea</strong><small>Tell us the reward, locations, and basic conditions.</small></span></li><li><b>2</b><span><strong>Review together</strong><small>We check clarity, accessibility, safety, and member value.</small></span></li><li><b>3</b><span><strong>Launch a pilot</strong><small>Your approved offer appears in the member rewards marketplace.</small></span></li></ol>
    </section>

    <section className="partner-form-section" id="partner-form">
      <div><span className="partner-eyebrow"><Icon name="message" size={18} /> Partner enquiry</span><h2>What could your company offer?</h2><p>This is a mocked proposal form for the MVP. Submissions are acknowledged in the browser and are not sent or stored.</p></div>
      {submitted ? <div className="partner-form-success" role="status"><span><Icon name="check" size={28} /></span><h3>Proposal preview complete</h3><p>Thanks — this demonstrates the partner submission experience. No information was sent.</p><button className="secondary-button" type="button" onClick={() => setSubmitted(false)}>Create another preview</button></div> : <form onSubmit={submit}>
        <label><span>Company name</span><input name="company" required placeholder="Your company" /></label>
        <label><span>Work email</span><input name="email" type="email" required placeholder="name@company.com" /></label>
        <label><span>Reward type</span><select name="rewardType" defaultValue="voucher"><option value="voucher">Voucher or credit</option><option value="product">Product</option><option value="experience">Experience</option><option value="service">Service</option></select></label>
        <label><span>Offer idea</span><textarea name="idea" required rows={4} placeholder="For example, a $5 weekday café voucher…" /></label>
        <button className="primary-button" type="submit">Preview proposal</button>
      </form>}
    </section>

    <footer className="partner-footer"><Link className="partner-brand" href="/home"><span aria-hidden="true">♥</span>Senior Quest</Link><p>Helping neighbours connect through meaningful activities.</p></footer>
  </main>;
}
