"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";

export function MobileMoreButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return <>
    <button
      className={`icon-button mobile-more-button${className ? ` ${className}` : ""}`}
      type="button"
      aria-label="Open menu"
      aria-expanded={open}
      aria-controls="mobile-more-menu"
      onClick={() => setOpen(true)}
    >
      <Icon name="menu" />
    </button>
    <MobileMoreSheet open={open} onClose={() => setOpen(false)} />
  </>;
}

export function MobileMoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return <div className="home-mobile-menu-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <nav className="home-mobile-menu" id="mobile-more-menu" role="dialog" aria-modal="true" aria-labelledby="mobile-more-menu-title">
      <div className="sheet-handle" aria-hidden="true" />
      <div className="home-mobile-menu-heading"><div><small>Senior Quest</small><h2 id="mobile-more-menu-title">More</h2></div><button className="icon-button" type="button" aria-label="Close menu" onClick={onClose}><Icon name="close" /></button></div>
      <div className="home-mobile-menu-links">
        <Link href="/quests" onClick={onClose}><span><Icon name="quests" /></span><span><strong>Activities</strong><small>Browse activities in your community</small></span><Icon name="chevron" /></Link>
        <Link href="/my-quests" onClick={onClose}><span><Icon name="check" /></span><span><strong>My Activities</strong><small>View joined and upcoming quests</small></span><Icon name="chevron" /></Link>
        <Link href="/messages" onClick={onClose}><span><Icon name="connections" /></span><span><strong>Contacts</strong><small>Connect with your community</small></span><Icon name="chevron" /></Link>
        <Link href="/rewards" onClick={onClose}><span><Icon name="gift" /></span><span><strong>Rewards</strong><small>See your points and partner deals</small></span><Icon name="chevron" /></Link>
        <Link href="/profile" onClick={onClose}><span><Icon name="profile" /></span><span><strong>My Profile</strong><small>Review your personal information</small></span><Icon name="chevron" /></Link>
        <Link href="/settings" onClick={onClose}><span><Icon name="settings" /></span><span><strong>Settings</strong><small>Accessibility, privacy, and security</small></span><Icon name="chevron" /></Link>
      </div>
    </nav>
  </div>;
}
