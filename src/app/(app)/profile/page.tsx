"use client";

import Image from "next/image";
import Link from "next/link";
import { useAppState } from "@/components/app-state";
import { Icon } from "@/components/icons";
import { MenuRow } from "@/components/menu-row";
import { PageHeader } from "@/components/page-header";

export default function ProfilePage() {
  const { showToast } = useAppState();

  return (
    <div className="page-container narrow-page profile-page">
      <PageHeader
        title="Profile"
        right={
          <Link className="icon-button" href="/settings" aria-label="Settings">
            <Icon name="settings" />
          </Link>
        }
      />
      <section className="profile-summary">
        <div className="profile-photo">
          <Image src="/assets/profile-maria.jpg" alt="Maria Santos" fill priority sizes="110px" />
          <button type="button" onClick={() => showToast("Profile photo picker is ready for backend wiring")} aria-label="Change profile photo">
            <Icon name="camera" size={18} />
          </button>
        </div>
        <h1>Maria Santos</h1>
        <p>Senior Member</p>
        <div className="profile-stats">
          <div><strong>12</strong><span>Quests Joined</span></div>
          <div><strong>8</strong><span>Connections</span></div>
          <div><strong>3</strong><span>Hosting</span></div>
        </div>
      </section>
      <section className="menu-card" aria-label="Profile options">
        <MenuRow icon="needs" label="My Needs" href="/needs" />
        <MenuRow icon="quests" label="My Quests" href="/my-quests" />
        <MenuRow icon="invite" label="My Invites" href="/invites" />
        <MenuRow icon="connections" label="My Connections" href="/messages" />
        <MenuRow icon="badge" label="My Badges" onClick={() => showToast("Badges opened")} />
      </section>
    </div>
  );
}
