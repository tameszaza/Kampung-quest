"use client";

import Link from "next/link";
import Image from "next/image";
import { Icon } from "@/components/icons";
import { QuestCard } from "@/components/quest-card";
import { DesktopQuestCard } from "@/components/desktop-quest-card";
import { useUser } from "@/components/user-context";
import { quests } from "@/data/mock-data";
import { SafeImage } from "@/components/safe-image";
import { canSeeDemoContent } from "@/lib/demo-access";
import { MobileMoreButton } from "@/components/mobile-more-menu";

export default function HomePage() {
  const { user } = useUser();
  const showDemo = canSeeDemoContent(user);
  const firstName = user.fullName.split(/\s+/)[0] || user.fullName;
  return (
    <div className="page-container home-page">
      <header className="home-header">
        <MobileMoreButton />
        <div className="home-greeting">
          <p>Good morning,</p>
          <h1>{firstName}! <span aria-hidden="true">👋</span></h1>
          <small>Ready for a meaningful day?</small>
        </div>
        <Link className="home-avatar" href="/profile" aria-label="Open profile">
          <SafeImage src={user.photoUrl ?? "/assets/profile-maria.jpg"} alt={user.fullName} fill sizes="58px" />
        </Link>
      </header>

      <div className="home-desktop-dashboard">
        <main className="home-desktop-main">
          <Link className="home-hero-card" href="/quests">
            <span className="home-hero-mark" aria-hidden="true"><Icon name="heart" size={32} strokeWidth={2.2} /></span>
            <span className="home-hero-copy">
              <strong>Connect. Share. Enjoy.</strong>
              <b>Life is better together.</b>
              <small>Join activities, share your skills, and make new friends in your community.</small>
            </span>
            <span className="home-hero-image"><Image src="/assets/cooking.jpg" alt="Older adults enjoying a cooking activity together" fill priority sizes="(min-width: 1024px) 38vw, 100vw" /></span>
          </Link>

          <div className="home-desktop-section-heading">
            <h2>Upcoming Quests</h2>
            <Link href="/my-quests">View all</Link>
          </div>
          <div className="home-desktop-quest-grid" aria-label="Upcoming quests">
            {showDemo ? quests.slice(0, 3).map((quest) => <DesktopQuestCard key={quest.slug} quest={quest} />) : (
              <div className="empty-state home-quest-empty"><span aria-hidden="true">✓</span><h2>No upcoming quests</h2><p>Your accepted matches will appear here.</p></div>
            )}
          </div>

          <section className="home-desktop-wellbeing">
            <div className="home-desktop-wellbeing-art"><Image src="/assets/onboarding-seniors.png" alt="" fill sizes="150px" /></div>
            <div><strong>Stay Active, Stay Connected</strong><p>Joining activities regularly can improve your well-being and brighten every day.</p></div>
            <Link className="primary-button" href="/quests">Browse Activities</Link>
          </section>
        </main>

        <aside className="home-desktop-aside" aria-label="Your Senior Quest shortcuts">
          <section className="home-connections-card">
            <div className="home-desktop-card-heading"><div><p>Your community</p><h2>Connections</h2></div><Icon name="connections" size={28} /></div>
            <div className="home-connection-people">
              {showDemo ? <div className="home-connection-avatars" aria-hidden="true">
                <span><Image src="/assets/profile-anne.jpg" alt="" fill sizes="44px" /></span>
                <span><Image src="/assets/profile-david.jpg" alt="" fill sizes="44px" /></span>
                <span><Image src="/assets/profile-john.jpg" alt="" fill sizes="44px" /></span>
                <span className="home-connection-count">+9</span>
              </div> : <span className="home-connection-empty" aria-hidden="true"><Icon name="connections" size={30} /></span>}
              <strong>{showDemo ? "12 friendly connections" : "No connections yet"}</strong>
              <small>{showDemo ? "People you can share moments with" : "Accepted matches will appear here"}</small>
            </div>
            <Link className="secondary-button" href="/messages">View Connections <Icon name="chevron" size={18} /></Link>
          </section>

          <section className="home-quick-actions">
            <div className="home-desktop-card-heading"><div><p>Make it easy</p><h2>Quick Actions</h2></div><Icon name="plus" size={27} /></div>
            <Link href="/quests"><span className="home-quick-icon"><Icon name="quests" size={20} /></span><span><strong>Browse All Activities</strong><small>Find something you&apos;ll enjoy</small></span><Icon name="chevron" size={18} /></Link>
            <Link href="/messages?assistant=1"><span className="home-quick-icon"><Icon name="plus" size={20} /></span><span><strong>Create a Quest</strong><small>Plan a meaningful activity</small></span><Icon name="chevron" size={18} /></Link>
            <Link href="/messages"><span className="home-quick-icon"><Icon name="invite" size={20} /></span><span><strong>Invite a Friend</strong><small>Share Senior Quest together</small></span><Icon name="chevron" size={18} /></Link>
            <Link href="/rewards"><span className="home-quick-icon"><Icon name="gift" size={20} /></span><span><strong>View Rewards</strong><small>See your points and partner deals</small></span><Icon name="chevron" size={18} /></Link>
            <Link href="/settings"><span className="home-quick-icon"><Icon name="help" size={20} /></span><span><strong>Help &amp; Support</strong><small>We&apos;re here whenever you need us</small></span><Icon name="chevron" size={18} /></Link>
          </section>
        </aside>
      </div>

      <div className="home-layout">
        <section className="home-primary">
          <section className="dashboard-stats" aria-label="Your Senior Quest summary">
            <Link href="/my-quests"><span>Upcoming Activities</span><strong>{showDemo ? 2 : 0}</strong><small>View your schedule</small></Link>
            <Link href="/messages"><span>New Messages</span><strong>0</strong><small>Unread messages</small></Link>
            <Link href="/quests"><span>New Matches</span><strong>{showDemo ? 3 : 0}</strong><small>Activities for you</small></Link>
            <Link href="/quests?tab=Invited"><span>Invites</span><strong>{showDemo ? 2 : 0}</strong><small>Pending invitations</small></Link>
          </section>
          <Link className="assistant-home-callout" href="/messages?assistant=1">
            <span aria-hidden="true">♥</span>
            <div><strong>What would feel good today?</strong><small>Talk with Senior Quest and I&apos;ll find a safe activity with neighbours.</small></div>
            <b>Let&apos;s talk <Icon name="chevron" size={18} /></b>
          </Link>

          <Link className="home-rewards-callout" href="/rewards">
            <span aria-hidden="true"><Icon name="gift" size={26} /></span>
            <div><strong>Community rewards</strong><small>Complete activities, earn points, and preview partner deals.</small></div>
            <b>View rewards <Icon name="chevron" size={18} /></b>
          </Link>

          {showDemo ? <Link className="invite-banner" href="/quests?tab=Invited">
            <span className="invite-gift" aria-hidden="true">🎁</span>
            <span>
              <strong>2 demo quest invites</strong>
              <small>Preview only — no real invitations were sent</small>
            </span>
            <span className="banner-action">View Invites</span>
          </Link> : null}

          <div className="section-heading">
            <h2>Recommended for You</h2>
            <Link href="/quests">See all</Link>
          </div>
          <div className="home-recommendation dashboard-quest-grid">
            {showDemo ? quests.slice(0, 3).map((quest) => <QuestCard key={quest.slug} quest={quest} compact />) : (
              <div className="empty-state home-quest-empty"><span aria-hidden="true">✓</span><h2>No recommendations yet</h2><p>Start a conversation to find a suitable activity.</p></div>
            )}
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
          <Link href="/quests?tab=Invited"><Icon name="invite" /><span><strong>My Invites</strong><small>{showDemo ? "2 demo invitations" : "No pending invitations"}</small></span><Icon name="chevron" /></Link>
        </aside>
      </div>
    </div>
  );
}
