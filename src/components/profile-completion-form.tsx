"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AccessibilityPreferenceFields } from "@/components/accessibility-preference-fields";
import { ProfilePhotoPicker } from "@/components/auth-form";
import { authClient } from "@/lib/auth-client";
import type { UserProfile } from "@/server/identity/types";

const interests = ["Cooking", "Gentle exercise", "Learning", "Games", "Gardening", "Conversation"];

export function ProfileCompletionForm({ user }: { user: UserProfile }) {
  const router = useRouter();
  const [selectedInterests, setSelectedInterests] = useState(user.preferences.interests);
  const [accessibilityPreferences, setAccessibilityPreferences] = useState(user.preferences.accessibilityPreferences);
  const [photo, setPhoto] = useState<File | null>(null);
  const [keepProviderPhoto, setKeepProviderPhoto] = useState(Boolean(user.photoUrl));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [available, setAvailable] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const localPreview = useMemo(() => photo ? URL.createObjectURL(photo) : null, [photo]);

  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);

  async function backToLogin() {
    setBusy(true);
    setError("");
    try {
      await authClient.signOut();
      router.replace("/login");
      router.refresh();
    } catch {
      setBusy(false);
      setError("Could not return to the login page. Please try again.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const username = String(form.get("username") ?? "").trim();
      setAvailable("checking");
      const check = await fetch(`/api/profile/username-available?username=${encodeURIComponent(username)}`);
      const checkResult = await check.json() as { available?: boolean; current?: boolean };
      if (!checkResult.available && !checkResult.current) {
        setAvailable("taken");
        return;
      }
      setAvailable("available");

      if (photo) {
        const upload = new FormData();
        upload.set("photo", photo);
        const uploadResponse = await fetch("/api/profile/avatar", { method: "POST", body: upload });
        const uploadResult = await uploadResponse.json() as { error?: string };
        if (!uploadResponse.ok) throw new Error(uploadResult.error ?? "Could not upload that photo");
      }

      const response = await fetch("/api/profile/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: form.get("fullName"), username, phone: form.get("phone"),
          dateOfBirth: form.get("dateOfBirth"), gender: form.get("gender"),
          preferredLanguage: form.get("preferredLanguage"), area: form.get("area"),
          interests: selectedInterests, groupSize: form.get("groupSize"),
          activityLevel: form.get("activityLevel"), accessibilityPreferences, useProviderPhoto: !photo && keepProviderPhoto,
        }),
      });
      const result = await response.json() as { error?: string; issues?: Array<{ message: string }> };
      if (!response.ok) throw new Error(result.issues?.[0]?.message ?? result.error ?? "Could not save your profile");
      router.replace("/home");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save your profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form register-form completion-form" onSubmit={submit}>
      <header>
        <button className="auth-back-link" type="button" onClick={backToLogin} disabled={busy}>← Back to log in</button>
        <p className="step-eyebrow">One last step</p><h2>Complete your profile</h2><p>Check the details from Google, then add what helps us personalize Senior Quest.</p>
      </header>
      {error ? <div className="form-alert" role="alert">{error}</div> : null}
      <div className="two-field-row">
        <label><span>Full name</span><input name="fullName" defaultValue={user.fullName} autoComplete="name" minLength={2} maxLength={100} required autoFocus /></label>
        <label><span>Unique display name</span><input name="username" defaultValue={user.username ?? user.fullName} minLength={3} maxLength={40} required onChange={() => setAvailable("idle")} />{available === "taken" ? <small className="availability taken" role="alert">That display name is already taken.</small> : null}</label>
      </div>
      <div className="two-field-row">
        <label><span>Email from Google</span><input className="email-locked" value={user.email ?? ""} readOnly aria-readonly="true" /></label>
        <label><span>Phone number (optional)</span><input name="phone" type="tel" defaultValue={user.phone ?? ""} autoComplete="tel" placeholder="+65 9123 4567" /></label>
      </div>
      <div className="two-field-row">
        <label><span>Date of birth</span><input name="dateOfBirth" type="date" defaultValue={user.dateOfBirth ?? ""} max="2010-12-31" /></label>
        <label><span>Gender</span><select name="gender" defaultValue={user.gender ?? ""}><option value="">Choose an option</option><option>Female</option><option>Male</option><option>Prefer not to say</option></select></label>
      </div>
      <div className="two-field-row">
        <label><span>Preferred language</span><select name="preferredLanguage" defaultValue={user.preferredLanguage || "English"}><option>English</option><option>Mandarin</option><option>Malay</option><option>Tamil</option></select></label>
        <label><span>Where do you live?</span><input name="area" defaultValue={user.area ?? ""} placeholder="Area or postal code" /></label>
      </div>
      {/* The provider URL is temporary and is imported into optimized local storage on submit. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {user.photoUrl && !localPreview ? <div className="provider-photo-choice"><img src={user.photoUrl} alt="Your Google profile" /><span><strong>Use your Google profile photo?</strong><small>You can change this anytime.</small></span><button type="button" role="switch" aria-checked={keepProviderPhoto} className={keepProviderPhoto ? "on" : ""} onClick={() => setKeepProviderPhoto((value) => !value)}><i /></button></div> : null}
      {(!user.photoUrl || !keepProviderPhoto || localPreview) ? <ProfilePhotoPicker preview={localPreview} onChange={(file) => { setPhoto(file); if (file) setKeepProviderPhoto(false); }} /> : null}
      <fieldset className="choice-field"><legend>Interests (optional)</legend><div className="choice-chips">{interests.map((interest) => <button className={selectedInterests.includes(interest) ? "selected" : ""} type="button" key={interest} onClick={() => setSelectedInterests((items) => items.includes(interest) ? items.filter((item) => item !== interest) : [...items, interest])}>{interest}</button>)}</div></fieldset>
      <div className="two-field-row"><label><span>Preferred group size</span><select name="groupSize" defaultValue={user.preferences.groupSize}><option value="one-to-one">One-to-one</option><option value="small">Small group (2–4)</option><option value="any">No preference</option></select></label><label><span>Activity level</span><select name="activityLevel" defaultValue={user.preferences.activityLevel}><option value="gentle">Gentle</option><option value="moderate">Moderate</option><option value="any">No preference</option></select></label></div>
      <AccessibilityPreferenceFields value={accessibilityPreferences} onChange={setAccessibilityPreferences} />
      <button className="primary-button" disabled={busy}>{busy ? "Saving your profile…" : "Finish and Continue"}</button>
    </form>
  );
}
