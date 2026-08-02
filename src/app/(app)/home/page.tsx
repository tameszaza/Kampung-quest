import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { QuestCard } from "@/components/quest-card";
import { quests } from "@/data/mock-data";

export default function HomePage() {
  return (
    <div className="page-container home-page">
      <header className="home-header">
        <Link className="icon-button mobile-only" href="/profile" aria-label="Open menu">
          <Icon name="menu" />
        </Link>
        <div className="home-greeting">
          <p>Good morning,</p>
          <h1>Maria! <span aria-hidden="true">👋</span></h1>
        </div>
        <Link className="home-avatar" href="/profile" aria-label="Open profile">
          <Image src="/assets/profile-maria.jpg" alt="Maria Santos" fill sizes="58px" />
        </Link>
      </header>

      <div className="home-layout">
        <section className="home-primary">
          <Link className="invite-banner" href="/invites">
            <span className="invite-gift" aria-hidden="true">🎁</span>
            <span>
              <strong>You have 2 new quest invites</strong>
              <small>See who wants you to join</small>
            </span>
            <span className="banner-action">View Invites</span>
          </Link>

          <div className="section-heading">
            <h2>Recommended for You</h2>
            <Link href="/quests">See all</Link>
          </div>
          <div className="home-recommendation">
            <QuestCard quest={quests[0]} compact />
          </div>

          <section className="status-section">
            <div className="section-heading"><h2>Your Status</h2></div>
            <Link className="status-card" href="/needs">
              <span>You&apos;re open to join quests</span>
              <strong>Change</strong>
            </Link>
          </section>
        </section>

        <aside className="home-sidebar" aria-label="Your Senior Quest shortcuts">
          <h2>Your Community</h2>
          <Link href="/needs"><Icon name="needs" /><span><strong>My Needs</strong><small>3 active needs</small></span><Icon name="chevron" /></Link>
          <Link href="/my-quests"><Icon name="quests" /><span><strong>My Quests</strong><small>2 upcoming quests</small></span><Icon name="chevron" /></Link>
          <Link href="/invites"><Icon name="invite" /><span><strong>My Invites</strong><small>2 new invitations</small></span><Icon name="chevron" /></Link>
        </aside>
      </div>
    </div>
  );
}
