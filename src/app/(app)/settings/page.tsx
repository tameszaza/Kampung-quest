"use client";

import { useRouter } from "next/navigation";
import { useAppState } from "@/components/app-state";
import { MenuRow } from "@/components/menu-row";
import { PageHeader } from "@/components/page-header";

export default function SettingsPage() {
  const router = useRouter();
  const { showToast } = useAppState();

  return (
    <div className="page-container narrow-page settings-page">
      <PageHeader title="Settings & Safety" back />
      <h2 className="settings-group-title">Account</h2>
      <section className="menu-card">
        <MenuRow icon="edit" label="Edit Profile" onClick={() => showToast("Edit profile form is ready for backend wiring")} />
        <MenuRow icon="bell" label="Notification Settings" onClick={() => showToast("Notification settings opened")} />
        <MenuRow icon="privacy" label="Privacy" onClick={() => showToast("Privacy settings opened")} />
      </section>

      <h2 className="settings-group-title">Safety</h2>
      <section className="menu-card">
        <MenuRow icon="blocked" label="Blocked Users" onClick={() => showToast("Blocked users opened")} />
        <MenuRow icon="help" label="Help & Support" onClick={() => showToast("Help and support opened")} />
        <MenuRow icon="shield" label="Emergency Contact" danger onClick={() => showToast("Emergency contact settings opened")} />
      </section>

      <button className="logout-button" type="button" onClick={() => router.push("/")}>Log Out</button>
    </div>
  );
}
