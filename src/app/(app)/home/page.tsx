"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { QuestCard } from "@/components/quest-card";
import { useUser } from "@/components/user-context";
import { quests } from "@/data/mock-data";
import { SafeImage } from "@/components/safe-image";

export default function HomePage() {
  const { user } = useUser();
  const firstName = user.fullName.split(/\s+/)[0] || user.fullName;
  return (
    <div className="page-container home-page">
      <header className="home-header">
        <Link className="icon-button mobile-only" href="/profile" aria-label="Open menu">
          <Icon name="menu" />
        </Link>
        <div className="home-greeting">
          <p>Good morning,</p>
          <h1>{firstName}! <span aria-hidden="true">👋</span></h1>
        </div>
        <Link className="home-avatar" href="/profile" aria-label="Open profile">
          <SafeImage src={user.photoUrl ?? "/assets/profile-maria.jpg"} alt={user.fullName} fill sizes="58px" />
        </Link>
      </header>

      <div className="home-layout">
        <section className="home-primary">
          <section className="dashboard-stats" aria-label="Your Senior Quest summary">
            <Link href="/my-quests"><span>Upcoming Activities</span><strong>2</strong><small>View your schedule</small></Link>
            <Link href="/messages"><span>New Messages</span><strong>2</strong><small>Unread messages</small></Link>
            <Link href="/quests"><span>New Matches</span><strong>3</strong><small>Activities for you</small></Link>
            <Link href="/quests?tab=Invited"><span>Invites</span><strong>2</strong><small>Pending invitations</small></Link>
          </section>
          <Link className="assistant-home-callout" href="/assistant">
            <span aria-hidden="true">♥</span>
            <div><strong>What would feel good today?</strong><small>Talk with Senior Quest and I&apos;ll find a safe activity with neighbours.</small></div>
            <b>Let&apos;s talk <Icon name="chevron" size={18} /></b>
          </Link>

          <Link className="invite-banner" href="/quests?tab=Invited">
            <span className="invite-gift" aria-hidden="true">🎁</span>
            <span>
              <strong>2 demo quest invites</strong>
              <small>Preview only — no real invitations were sent</small>
            </span>
            <span className="banner-action">View Invites</span>
          </Link>

          <div className="section-heading">
            <h2>Recommended for You</h2>
            <Link href="/quests">See all</Link>
          </div>
          <div className="home-recommendation dashboard-quest-grid">
            {quests.slice(0, 3).map((quest) => <QuestCard key={quest.slug} quest={quest} compact />)}
          </div>

          <section className="status-section">
            <div className="section-heading"><h2>Your Status</h2></div>
            <Link className="status-card" href="/needs">
              <span>You&apos;re open to join quests</span>
              <strong>Change</strong>
            </Link>
          </section>
          <section className="desktop-wellbeing-banner"><span><strong>Stay Active, Stay Connected</strong><small>Joining activities regularly can improve your well-being and brighten every day.</small></span><Link className="primary-button" href="/quests">Browse Activities</Link></section>
        </section>

        <aside className="home-sidebar" aria-label="Your Senior Quest shortcuts">
          <h2>Your Community</h2>
          <Link href="/needs"><Icon name="needs" /><span><strong>What I&apos;ve shared</strong><small>Review your Senior Quest memory</small></span><Icon name="chevron" /></Link>
          <Link href="/quests"><Icon name="quests" /><span><strong>My Recommendations</strong><small>Quests prepared by the engine</small></span><Icon name="chevron" /></Link>
          <Link href="/quests?tab=Invited"><Icon name="invite" /><span><strong>My Invites</strong><small>2 demo invitations</small></span><Icon name="chevron" /></Link>
        </aside>
      </div>
    </div>
  );
}
