"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import type { UserPreferences } from "@/server/identity/types";

type PrivacyPreferences = Pick<UserPreferences, "profileVisibility" | "messagePrivacy" | "showOnlineStatus">;

type SecuritySession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  userAgent: string | null;
  current: boolean;
};

type SecuritySettingsProps = {
  email: string | null;
  preferences: PrivacyPreferences;
  onPrivacyChange: (changes: Partial<PrivacyPreferences>) => void;
  onSavePrivacy: () => Promise<void>;
  savingPrivacy: boolean;
};

function passwordChecks(password: string, confirmation: string) {
  return [
    { label: "At least 8 characters", valid: password.length >= 8 },
    { label: "Includes a letter", valid: /[A-Za-z]/.test(password) },
    { label: "Includes a number", valid: /[0-9]/.test(password) },
    { label: "Passwords match", valid: password.length > 0 && password === confirmation },
  ];
}

function deviceName(userAgent: string | null) {
  if (!userAgent) return "Another device";
  if (/iPhone|iPad|Android/i.test(userAgent)) return "Mobile device";
  if (/Firefox/i.test(userAgent)) return "Firefox browser";
  if (/Edg/i.test(userAgent)) return "Edge browser";
  if (/Chrome/i.test(userAgent)) return "Chrome browser";
  if (/Safari/i.test(userAgent)) return "Safari browser";
  return "Another browser";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently active";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function SecurityHeading({ id, icon, title, detail }: { id: string; icon: IconName; title: string; detail?: string }) {
  return <header className="security-heading"><span className="security-heading-icon" aria-hidden="true"><Icon name={icon} size={22} /></span><span><h4 id={id}>{title}</h4>{detail ? <p>{detail}</p> : null}</span></header>;
}

export function SecuritySettings({ email, preferences, onPrivacyChange, onSavePrivacy, savingPrivacy }: SecuritySettingsProps) {
  const [hasPassword, setHasPassword] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [sessions, setSessions] = useState<SecuritySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [sessionMessage, setSessionMessage] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [sessionBusy, setSessionBusy] = useState("");
  const [confirmSessionId, setConfirmSessionId] = useState<string | null>(null);
  const [confirmOtherSessions, setConfirmOtherSessions] = useState(false);
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const checks = useMemo(() => passwordChecks(newPassword, confirmation), [confirmation, newPassword]);
  const passwordReady = checks.every((check) => check.valid);
  const otherSessions = sessions.filter((session) => !session.current);

  async function loadSecurity() {
    setLoading(true);
    setLoadingError("");
    try {
      const response = await fetch("/api/account/security", { cache: "no-store" });
      const result = await response.json() as { error?: string; hasPassword?: boolean; providers?: string[]; sessions?: SecuritySession[] };
      if (!response.ok) throw new Error(result.error ?? "Could not load security details");
      setHasPassword(Boolean(result.hasPassword));
      setProviders(result.providers ?? []);
      setSessions(result.sessions ?? []);
    } catch (reason) {
      setLoadingError(reason instanceof Error ? reason.message : "Could not load security details");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSecurity(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordReady || (hasPassword && !currentPassword)) return;
    setPasswordBusy(true);
    setPasswordMessage("");
    setPasswordError("");
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: hasPassword ? currentPassword : undefined, newPassword, revokeOtherSessions }),
      });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update your password");
      setHasPassword(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setPasswordMessage(result.message ?? "Your password has been updated.");
      await loadSecurity();
    } catch (reason) {
      setPasswordError(reason instanceof Error ? reason.message : "Could not update your password");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function revokeSession(sessionId: string) {
    setSessionBusy(sessionId);
    setSessionMessage("");
    setSessionError("");
    try {
      const response = await fetch("/api/account/security", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke-session", sessionId }),
      });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not sign out that device");
      setConfirmSessionId(null);
      setSessionMessage(result.message ?? "The device has been signed out.");
      await loadSecurity();
    } catch (reason) {
      setSessionError(reason instanceof Error ? reason.message : "Could not sign out that device");
    } finally {
      setSessionBusy("");
    }
  }

  async function revokeOthers() {
    setSessionBusy("others");
    setSessionMessage("");
    setSessionError("");
    try {
      const response = await fetch("/api/account/security", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke-other-sessions" }),
      });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not sign out other devices");
      setConfirmOtherSessions(false);
      setSessionMessage(result.message ?? "Other devices have been signed out.");
      await loadSecurity();
    } catch (reason) {
      setSessionError(reason instanceof Error ? reason.message : "Could not sign out other devices");
    } finally {
      setSessionBusy("");
    }
  }

  return (
    <section className="security-settings" aria-label="Privacy and password security">
      <div className="security-intro">
        <span className="security-intro-icon" aria-hidden="true"><Icon name="shield" size={28} /></span>
        <div className="security-intro-copy">
          <div className="security-kicker"><span>Account</span><b className="security-status"><Icon name="check" size={14} /> Protected</b></div>
          <h3>Privacy &amp; security</h3>
          <p>Control your profile, messages, password, and devices.</p>
        </div>
        {email ? <div className="security-email"><Icon name="lock" size={18} /><span><small>Sign-in email</small><strong>{email}</strong></span></div> : null}
      </div>

      <section className="security-section" aria-labelledby="privacy-heading">
        <SecurityHeading id="privacy-heading" icon="privacy" title="Privacy" detail="Choose who can see and contact you." />
        <div className="security-choice-list">
          <label className="security-choice"><span className="security-choice-icon" aria-hidden="true"><Icon name="profile" size={20} /></span><span className="security-choice-copy"><strong>Profile visibility</strong><small>Who can find you</small></span><select aria-label="Profile visibility" value={preferences.profileVisibility} onChange={(event) => onPrivacyChange({ profileVisibility: event.target.value as PrivacyPreferences["profileVisibility"] })}><option value="community">Everyone</option><option value="connections">Connections</option><option value="private">Nobody</option></select></label>
          <label className="security-choice"><span className="security-choice-icon" aria-hidden="true"><Icon name="message" size={20} /></span><span className="security-choice-copy"><strong>New messages</strong><small>Who can start a chat</small></span><select aria-label="Who can start a direct chat" value={preferences.messagePrivacy} onChange={(event) => onPrivacyChange({ messagePrivacy: event.target.value as PrivacyPreferences["messagePrivacy"] })}><option value="everyone">Everyone</option><option value="connections">Connections</option><option value="nobody">Nobody new</option></select></label>
          <SwitchSetting icon="profile" label="Online status" help="Let people see when you are active" checked={preferences.showOnlineStatus} onChange={(checked) => onPrivacyChange({ showOnlineStatus: checked })} />
        </div>
        <button className="primary-button security-save" type="button" onClick={() => void onSavePrivacy()} disabled={savingPrivacy}><Icon name="check" size={18} />{savingPrivacy ? "Saving…" : "Save choices"}</button>
      </section>

      <section className="security-section" aria-labelledby="password-heading">
        <SecurityHeading id="password-heading" icon="lock" title="Password" detail={hasPassword ? "Change your sign-in password." : "Add a password for another way to sign in."} />
        <div className={`security-password-status ${hasPassword ? "is-set" : "is-missing"}`}><Icon name={hasPassword ? "check" : "shield"} size={18} /><strong>{hasPassword ? "Password protected" : "No password set"}</strong></div>
        <form className="security-password-form" onSubmit={changePassword}>
          {hasPassword ? <PasswordInput label="Current password" value={currentPassword} visible={showCurrentPassword} onChange={setCurrentPassword} onToggle={() => setShowCurrentPassword((value) => !value)} autoComplete="current-password" /> : null}
          <PasswordInput label="New password" value={newPassword} visible={showNewPassword} onChange={setNewPassword} onToggle={() => setShowNewPassword((value) => !value)} autoComplete="new-password" />
          <label className="security-field"><span>Confirm new password</span><input type={showNewPassword ? "text" : "password"} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" /></label>
          <ul className="password-checks" aria-label="Password requirements">{checks.map((check) => <li className={check.valid ? "valid" : ""} key={check.label}><span aria-hidden="true">{check.valid ? "✓" : "○"}</span>{check.label}</li>)}</ul>
          <SwitchSetting label="Sign out other devices" help="Recommended after changing a password" checked={revokeOtherSessions} onChange={setRevokeOtherSessions} />
          {passwordError ? <p className="security-alert" role="alert">{passwordError}</p> : null}
          {passwordMessage ? <p className="security-success" role="status">{passwordMessage}</p> : null}
          <button className="primary-button security-save" type="submit" disabled={passwordBusy || !passwordReady || (hasPassword && !currentPassword)}><Icon name="lock" size={18} />{passwordBusy ? "Updating…" : hasPassword ? "Change password" : "Add password"}</button>
        </form>
      </section>

      <section className="security-section" aria-labelledby="sessions-heading">
        <div className="security-section-heading"><SecurityHeading id="sessions-heading" icon="settings" title="Signed-in devices" detail="Review where your account is open." /><button className="quiet-button" type="button" onClick={() => void loadSecurity()} disabled={loading} aria-label="Refresh signed-in devices"><Icon name="settings" size={17} />Refresh</button></div>
        {sessionError ? <p className="security-alert" role="alert">{sessionError}</p> : null}
        {sessionMessage ? <p className="security-success" role="status">{sessionMessage}</p> : null}
        {loading ? <p className="security-muted" role="status">Loading your signed-in devices…</p> : loadingError ? <div className="security-alert" role="alert">{loadingError}<button className="text-button" type="button" onClick={() => void loadSecurity()}>Try again</button></div> : sessions.length === 0 ? <p className="security-muted">No active sessions were found. Your current session may need refreshing.</p> : <div className="session-list">{sessions.map((session) => <div className="session-row" key={session.id}><span className="session-icon" aria-hidden="true">{session.current ? "✓" : "⌁"}</span><span><strong>{session.current ? "This device" : deviceName(session.userAgent)}</strong><small>{session.current ? "Currently active" : `Last active ${formatDate(session.updatedAt)}`}</small></span>{session.current ? <b className="session-current">Current</b> : confirmSessionId === session.id ? <span className="session-confirm"><button className="text-button" type="button" onClick={() => setConfirmSessionId(null)} disabled={Boolean(sessionBusy)}>Keep</button><button className="danger-text-button" type="button" onClick={() => void revokeSession(session.id)} disabled={Boolean(sessionBusy)}>{sessionBusy === session.id ? "Signing out…" : "Sign out"}</button></span> : <button className="quiet-button" type="button" onClick={() => setConfirmSessionId(session.id)}>Sign out</button>}</div>)}</div>}
        {!loading && !loadingError && otherSessions.length > 0 ? confirmOtherSessions ? <div className="security-confirm"><span>Sign out all other devices?</span><button className="text-button" type="button" onClick={() => setConfirmOtherSessions(false)} disabled={Boolean(sessionBusy)}>Keep them</button><button className="danger-text-button" type="button" onClick={() => void revokeOthers()} disabled={Boolean(sessionBusy)}>{sessionBusy === "others" ? "Signing out…" : "Sign out others"}</button></div> : <button className="secondary-button security-wide-action" type="button" onClick={() => setConfirmOtherSessions(true)}>Sign out all other devices</button> : null}
      </section>

      {providers.length > 0 ? <div className="security-provider-note"><span>Sign-in methods</span><div>{providers.map((provider) => <b key={provider}>{provider === "credential" ? "Password" : provider === "google" ? "Google" : provider}</b>)}</div></div> : null}
    </section>
  );
}

function PasswordInput({ label, value, visible, onChange, onToggle, autoComplete }: { label: string; value: string; visible: boolean; onChange: (value: string) => void; onToggle: () => void; autoComplete: "current-password" | "new-password" }) {
  return <label className="security-field"><span>{label}</span><span className="security-password-input"><input type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} /><button type="button" onClick={onToggle} aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>{visible ? "Hide" : "Show"}</button></span></label>;
}

function SwitchSetting({ icon = "shield", label, help, checked, onChange }: { icon?: IconName; label: string; help: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="switch-setting security-switch-setting"><span className="security-choice-icon" aria-hidden="true"><Icon name={icon} size={20} /></span><span><strong>{label}</strong><small>{help}</small></span><button className={checked ? "on" : ""} type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)}><i /></button></div>;
}
