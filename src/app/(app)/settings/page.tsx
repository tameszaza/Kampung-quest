"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AccessibilityPreferenceFields } from "@/components/accessibility-preference-fields";
import { useAppState } from "@/components/app-state";
import { Icon } from "@/components/icons";
import { MenuRow } from "@/components/menu-row";
import { PageHeader } from "@/components/page-header";
import { SecuritySettings } from "@/components/security-settings";
import { useUser } from "@/components/user-context";
import { authClient } from "@/lib/auth-client";
import type { ChatContact, EmergencyContact, UserPreferences, UserProfile } from "@/server/identity/types";

export default function SettingsPage() {
  const router = useRouter();
  const { showToast } = useAppState();
  const { user, setUser } = useUser();
  const [preferences, setPreferences] = useState(user.preferences);
  const [language, setLanguage] = useState(user.preferredLanguage);
  const [area, setArea] = useState(user.area ?? "");
  const [fullName, setFullName] = useState(user.fullName);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [emergency, setEmergency] = useState<EmergencyContact | null>(user.emergencyContact);
  const [emergencyName, setEmergencyName] = useState(user.emergencyContact?.name ?? "");
  const [emergencyRelationship, setEmergencyRelationship] = useState(user.emergencyContact?.relationship ?? "");
  const [emergencyPhone, setEmergencyPhone] = useState(user.emergencyContact?.phone ?? "");
  const [emergencyEmail, setEmergencyEmail] = useState(user.emergencyContact?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<ChatContact[]>([]);
  const [showBlockedUsers, setShowBlockedUsers] = useState(false);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);

  function update<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  function updatePrivacy(changes: Partial<Pick<UserPreferences, "profileVisibility" | "messagePrivacy" | "showOnlineStatus">>) {
    setPreferences((current) => ({ ...current, ...changes }));
  }

  async function savePreferences() {
    setSaving(true);
    try {
      const response = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...preferences,
          preferredLanguage: language,
          area: area || null,
          fullName,
          phone,
          emergencyContact: emergencyName.trim() ? {
            name: emergencyName,
            relationship: emergencyRelationship,
            phone: emergencyPhone,
            email: emergencyEmail || null,
          } : null,
        }),
      });
      const result = await response.json() as { user?: UserProfile; error?: string };
      if (!response.ok || !result.user) throw new Error(result.error ?? "Could not save settings");
      setUser(result.user);
      setEmergency(result.user.emergencyContact);
      setFullName(result.user.fullName);
      setPhone(result.user.phone ?? "");
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
      <h2 className="settings-group-title">My profile</h2>
      <section className="preference-card settings-profile-card">
        <label><span>Full name</span><input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" /></label>
        <label><span>Phone number</span><input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="Optional" /></label>
        <button className="primary-button settings-save" type="button" onClick={savePreferences} disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>
      </section>
      <h2 className="settings-group-title">Account</h2>
      <section className="menu-card">
        <MenuRow icon="privacy" label="Privacy & Password Security" ariaExpanded={securityOpen} onClick={() => setSecurityOpen((open) => !open)} />
      </section>
      {securityOpen ? <SecuritySettings
        email={user.email}
        preferences={preferences}
        onPrivacyChange={updatePrivacy}
        onSavePrivacy={savePreferences}
        savingPrivacy={saving}
      /> : null}

      <h2 className="settings-group-title">My Preferences</h2>
      <section className="preference-card">
        <label><span>Preferred language</span><select value={language} onChange={(event) => setLanguage(event.target.value)}><option>English</option><option>Mandarin</option><option>Malay</option><option>Tamil</option></select></label>
        <label><span>My area</span><input value={area} onChange={(event) => setArea(event.target.value)} placeholder="Area or postal code" /></label>
        <label><span>Preferred group size</span><select value={preferences.groupSize} onChange={(event) => update("groupSize", event.target.value as UserPreferences["groupSize"])}><option value="one-to-one">One-to-one</option><option value="small">Small group (2–4)</option><option value="any">No preference</option></select></label>
        <label><span>Activity level</span><select value={preferences.activityLevel} onChange={(event) => update("activityLevel", event.target.value as UserPreferences["activityLevel"])}><option value="gentle">Gentle</option><option value="moderate">Moderate</option><option value="any">No preference</option></select></label>
        <AccessibilityPreferenceFields value={preferences.accessibilityPreferences} onChange={(value) => update("accessibilityPreferences", value)} />
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
      </section>
      <section className="preference-card emergency-contact-card">
        <div className="settings-card-heading"><span className="settings-card-icon"><Icon name="shield" size={20} /></span><div><h3>Emergency contact</h3><p>Someone trusted we can show to people in your conversations.</p></div></div>
        <label><span>Contact name</span><input value={emergencyName} onChange={(event) => setEmergencyName(event.target.value)} placeholder="Full name" autoComplete="name" /></label>
        <label><span>Relationship</span><input value={emergencyRelationship} onChange={(event) => setEmergencyRelationship(event.target.value)} placeholder="For example, daughter or neighbour" /></label>
        <label><span>Phone number</span><input value={emergencyPhone} onChange={(event) => setEmergencyPhone(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="Required" /></label>
        <label><span>Email (optional)</span><input value={emergencyEmail} onChange={(event) => setEmergencyEmail(event.target.value)} inputMode="email" autoComplete="email" placeholder="name@example.com" /></label>
        <div className="settings-inline-actions"><button className="primary-button settings-save" type="button" onClick={savePreferences} disabled={saving}>{saving ? "Saving…" : emergency ? "Save contact" : "Add contact"}</button>{emergency ? <button className="quiet-button" type="button" onClick={() => { setEmergency(null); setEmergencyName(""); setEmergencyRelationship(""); setEmergencyPhone(""); setEmergencyEmail(""); }}>Clear</button> : null}</div>
      </section>

      <button className="logout-button" type="button" onClick={logOut}>Log Out</button>
    </div>
  );
}

function SwitchSetting({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="switch-setting"><span><strong>{label}</strong><small>{help}</small></span><button className={checked ? "on" : ""} type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)}><i /></button></div>;
}
