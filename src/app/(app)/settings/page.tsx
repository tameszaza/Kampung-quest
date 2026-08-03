"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/components/app-state";
import { MenuRow } from "@/components/menu-row";
import { PageHeader } from "@/components/page-header";
import { useUser } from "@/components/user-context";
import { authClient } from "@/lib/auth-client";
import type { ChatContact, UserPreferences, UserProfile } from "@/server/identity/types";

export default function SettingsPage() {
  const router = useRouter();
  const { showToast } = useAppState();
  const { user, setUser } = useUser();
  const [preferences, setPreferences] = useState(user.preferences);
  const [language, setLanguage] = useState(user.preferredLanguage);
  const [area, setArea] = useState(user.area ?? "");
  const [saving, setSaving] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<ChatContact[]>([]);
  const [showBlockedUsers, setShowBlockedUsers] = useState(false);
  const [blockedLoading, setBlockedLoading] = useState(false);

  function update<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  async function savePreferences() {
    setSaving(true);
    try {
      const response = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...preferences, preferredLanguage: language, area: area || null }),
      });
      const result = await response.json() as { user?: UserProfile; error?: string };
      if (!response.ok || !result.user) throw new Error(result.error ?? "Could not save settings");
      setUser(result.user);
      showToast("Your preferences have been saved");
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  async function logOut() {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  async function toggleBlockedUsers() {
    const next = !showBlockedUsers;
    setShowBlockedUsers(next);
    if (!next || blockedUsers.length) return;
    setBlockedLoading(true);
    try {
      const response = await fetch("/api/chat/blocks", { cache: "no-store" });
      const result = await response.json() as { users?: ChatContact[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not load blocked users");
      setBlockedUsers(result.users ?? []);
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Could not load blocked users");
    } finally {
      setBlockedLoading(false);
    }
  }

  async function unblock(user: ChatContact) {
    try {
      const response = await fetch("/api/chat/blocks", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not unblock this person");
      setBlockedUsers((items) => items.filter((item) => item.id !== user.id));
      showToast(`${user.fullName} can message you again`);
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Could not unblock this person");
    }
  }

  return (
    <div className="page-container narrow-page settings-page">
      <PageHeader title="Settings & Safety" back />
      <h2 className="settings-group-title">Account</h2>
      <section className="menu-card">
        <MenuRow icon="privacy" label="Privacy & Password Security" onClick={() => showToast("Your password is hashed and your sign-in session is protected")} />
      </section>

      <h2 className="settings-group-title">My Preferences</h2>
      <section className="preference-card">
        <label><span>Preferred language</span><select value={language} onChange={(event) => setLanguage(event.target.value)}><option>English</option><option>Mandarin</option><option>Malay</option><option>Tamil</option></select></label>
        <label><span>My area</span><input value={area} onChange={(event) => setArea(event.target.value)} placeholder="Area or postal code" /></label>
        <label><span>Preferred group size</span><select value={preferences.groupSize} onChange={(event) => update("groupSize", event.target.value as UserPreferences["groupSize"])}><option value="one-to-one">One-to-one</option><option value="small">Small group (2–4)</option><option value="any">No preference</option></select></label>
        <label><span>Activity level</span><select value={preferences.activityLevel} onChange={(event) => update("activityLevel", event.target.value as UserPreferences["activityLevel"])}><option value="gentle">Gentle</option><option value="moderate">Moderate</option><option value="any">No preference</option></select></label>
        <SwitchSetting label="Extra-large text" help="Make text easier to read" checked={preferences.textSize === "extra-large"} onChange={(checked) => update("textSize", checked ? "extra-large" : "large")} />
        <SwitchSetting label="High contrast" help="Make controls and text stand out more" checked={preferences.highContrast} onChange={(checked) => update("highContrast", checked)} />
        <SwitchSetting label="Message notifications" help="Let me know when someone replies" checked={preferences.messageNotifications} onChange={(checked) => update("messageNotifications", checked)} />
        <SwitchSetting label="Quest notifications" help="Reminders about activities and invites" checked={preferences.questNotifications} onChange={(checked) => update("questNotifications", checked)} />
        <button className="primary-button settings-save" type="button" onClick={savePreferences} disabled={saving}>{saving ? "Saving…" : "Save Preferences"}</button>
      </section>

      <h2 className="settings-group-title">Safety</h2>
      <section className="menu-card">
        <MenuRow icon="blocked" label="Blocked Users" onClick={() => void toggleBlockedUsers()} />
        {showBlockedUsers ? <div className="blocked-users-panel">{blockedLoading ? <p>Loading blocked users…</p> : blockedUsers.length === 0 ? <p>You have not blocked anyone.</p> : blockedUsers.map((blocked) => <div className="blocked-user-row" key={blocked.id}><span><strong>{blocked.fullName}</strong>{blocked.username ? <small>@{blocked.username}</small> : null}</span><button type="button" onClick={() => void unblock(blocked)}>Unblock</button></div>)}</div> : null}
        <MenuRow icon="help" label="Help & Support" onClick={() => showToast("Support: 1800 555 010")} />
        <MenuRow icon="shield" label="Emergency Contact" danger onClick={() => showToast("Call local emergency services if anyone is in immediate danger")} />
      </section>

      <button className="logout-button" type="button" onClick={logOut}>Log Out</button>
    </div>
  );
}

function SwitchSetting({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="switch-setting"><span><strong>{label}</strong><small>{help}</small></span><button className={checked ? "on" : ""} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><i /></button></div>;
}
