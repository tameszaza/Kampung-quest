"use client";

import Link from "next/link";
import { useAppState } from "@/components/app-state";
import { Icon } from "@/components/icons";
import { MenuRow } from "@/components/menu-row";
import { PageHeader } from "@/components/page-header";
import { ProfilePhotoEditor } from "@/components/profile-photo-editor";
import { useUser } from "@/components/user-context";

export default function ProfilePage() {
  const { showToast } = useAppState();
  const { user } = useUser();

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
        <ProfilePhotoEditor />
        <h1>{user.fullName}</h1>
        <p>{user.username ? `@${user.username}` : "Senior Member"}</p>
        <div className="profile-stats">
          <div><strong>12</strong><span>Quests Joined</span></div>
          <div><strong>8</strong><span>Connections</span></div>
          <div><strong>3</strong><span>Hosting</span></div>
        </div>
      </section>
      <section className="menu-card" aria-label="Profile options">
        <MenuRow icon="needs" label="My Needs" href="/needs" />
        <MenuRow icon="quests" label="My Quests" href="/my-quests" />
        <MenuRow icon="invite" label="My Invites" href="/quests?tab=Invited" />
        <MenuRow icon="connections" label="My Connections" href="/messages" />
        <MenuRow icon="badge" label="My Badges" onClick={() => showToast("Badges opened")} />
      </section>
    </div>
  );
}
