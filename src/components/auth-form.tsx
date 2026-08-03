"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { authClient } from "@/lib/auth-client";

type FormMode = "login" | "register";
type Availability = "idle" | "checking" | "available" | "taken";

const interestOptions = ["Cooking", "Gentle exercise", "Learning", "Games", "Gardening", "Conversation"];

export function AuthForm({ mode, googleEnabled }: { mode: FormMode; googleEnabled: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(searchParams.get("error") === "google" ? "Google sign-in could not be completed. Please try again." : "");
  const [interests, setInterests] = useState<string[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [usernameAvailability, setUsernameAvailability] = useState<Availability>("idle");
  const photoPreview = useMemo(() => photo ? URL.createObjectURL(photo) : null, [photo]);

  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);

  async function nextStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    if (step === 1) {
      const password = valueOf(form, "password");
      const confirmation = valueOf(form, "confirmPassword");
      if (password !== confirmation) {
        setError("The passwords do not match. Please try again.");
        return;
      }
      const username = valueOf(form, "username");
      setUsernameAvailability("checking");
      const response = await fetch(`/api/profile/username-available?username=${encodeURIComponent(username)}`);
      const result = await response.json() as { available?: boolean };
      if (!result.available) {
        setUsernameAvailability("taken");
        setError("That display name is already taken. Please choose another one.");
        return;
      }
      setUsernameAvailability("available");
    }
    setStep((value) => Math.min(3, value + 1));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      if (mode === "login") await logIn(form);
      else await register(form);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We couldn’t complete that request");
    } finally {
      setBusy(false);
    }
  }

  async function logIn(form: FormData) {
    const identifier = String(form.get("identifier") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const rememberMe = form.get("rememberMe") === "on";
    const result = identifier.includes("@")
      ? await authClient.signIn.email({ email: identifier, password, rememberMe })
      : await authClient.signIn.username({ username: identifier, password, rememberMe });
    if (result.error) throw new Error(friendlyAuthError(result.error.message));
    const requested = searchParams.get("next");
    router.replace(requested?.startsWith("/") ? requested : "/auth/continue");
    router.refresh();
  }

  async function register(form: FormData) {
    const fullName = String(form.get("fullName") ?? "").trim();
    const username = String(form.get("username") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const result = await authClient.signUp.email({
      name: fullName,
      email,
      password,
      username,
      displayUsername: username,
    });
    if (result.error) throw new Error(friendlyAuthError(result.error.message));

    if (photo) await uploadAvatar(photo);
    const response = await fetch("/api/profile/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName,
        username,
        phone: form.get("phone"),
        dateOfBirth: form.get("dateOfBirth"),
        gender: form.get("gender"),
        preferredLanguage: form.get("preferredLanguage"),
        area: form.get("area"),
        groupSize: form.get("groupSize"),
        activityLevel: form.get("activityLevel"),
        interests,
        useProviderPhoto: false,
      }),
    });
    const completion = await response.json() as { error?: string; issues?: Array<{ message: string }> };
    if (!response.ok) throw new Error(completion.issues?.[0]?.message ?? completion.error ?? "Could not save your profile");
    router.replace("/home");
    router.refresh();
  }

  async function continueWithGoogle() {
    if (!googleEnabled) {
      setError("Google sign-in is not configured on this server yet.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/auth/continue",
      newUserCallbackURL: "/register/complete",
      errorCallbackURL: `/${mode}?error=google`,
    });
    if (result?.error) {
      setBusy(false);
      setError(friendlyAuthError(result.error.message));
    }
  }

  function continueWithFacebook() {
    setError("Facebook sign-in is not available yet. You can use Google or your email to log in.");
  }

  if (mode === "login") {
    return (
      <form className="auth-form" onSubmit={submit}>
        <header><h2>Welcome back!</h2><p>Log in to continue your journey.</p></header>
        {error ? <div className="form-alert" role="alert">{error}</div> : null}
        <label className="auth-login-field">
          <span>Email or display name</span>
          <span className="auth-input-wrap"><Icon name="profile" size={21} /><input name="identifier" autoComplete="username" placeholder="Enter your email or display name" required autoFocus /></span>
        </label>
        <label className="auth-login-field">
          <span>Password</span>
          <PasswordField name="password" visible={showPassword} onToggle={() => setShowPassword((value) => !value)} autoComplete="current-password" />
        </label>
        <div className="auth-help-row"><label className="check-label"><input name="rememberMe" type="checkbox" defaultChecked /> Remember me</label><a href="tel:1800555010">Forgot password?</a></div>
        <button className="primary-button auth-submit" disabled={busy}>{busy ? "Logging in…" : "Log In"}</button>
        <AuthDivider />
        <button className="social-auth-button" type="button" onClick={continueWithGoogle} disabled={busy || !googleEnabled} title={googleEnabled ? undefined : "Google sign-in is not configured on this server"}><GoogleMark /> Continue with Google</button>
        <button className="social-auth-button facebook-auth-button" type="button" onClick={continueWithFacebook} disabled={busy}><span className="facebook-mark" aria-hidden="true">f</span> Continue with Facebook</button>
        <p className="auth-switch">Don’t have an account? <Link href="/register">Sign up</Link></p>
      </form>
    );
  }

  return (
    <form className="auth-form register-form" onSubmit={step === 3 ? submit : nextStep}>
      <header>
        <p className="step-eyebrow">Step {step} of 3</p>
        <h2>{step === 1 ? "Create your account" : step === 2 ? "Tell us about yourself" : "What do you enjoy?"}</h2>
        <p>{step === 1 ? "It’s quick and easy." : step === 2 ? "This helps us find the right activities and friends for you." : "You can change these choices anytime."}</p>
      </header>
      <div className="step-progress" aria-label={`Registration step ${step} of 3`}>
        {[1, 2, 3].map((item) => <span key={item} className={item <= step ? "active" : ""}>{item}</span>)}
      </div>
      {step === 1 ? <button className="social-auth-button" type="button" onClick={continueWithGoogle} disabled={busy || !googleEnabled} title={googleEnabled ? undefined : "Google sign-in is not configured on this server"}><GoogleMark /> Sign up with Google</button> : null}
      {step === 1 ? <AuthDivider label="or register with email" /> : null}
      {error ? <div className="form-alert" role="alert">{error}</div> : null}

      <section className={step === 1 ? "form-step active" : "form-step"} aria-hidden={step !== 1}>
        <div className="two-field-row">
          <label><span>Full name</span><input name="fullName" autoComplete="name" placeholder="Enter your full name" required={step === 1} /></label>
          <label><span>Unique display name</span><input name="username" autoComplete="username" placeholder="For example, Maria Santos" required={step === 1} onChange={() => setUsernameAvailability("idle")} /><small className={`availability ${usernameAvailability}`}>{availabilityCopy(usernameAvailability)}</small></label>
        </div>
        <div className="two-field-row">
          <label><span>Email</span><input name="email" type="email" autoComplete="email" placeholder="you@example.com" required={step === 1} /></label>
          <label><span>Phone number (optional)</span><input name="phone" type="tel" autoComplete="tel" placeholder="+65 9123 4567" /></label>
        </div>
        <div className="two-field-row">
          <label><span>Password</span><PasswordField name="password" visible={showPassword} onToggle={() => setShowPassword((value) => !value)} autoComplete="new-password" /></label>
          <label><span>Confirm password</span><input name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Type your password again" required={step === 1} /></label>
        </div>
      </section>

      <section className={step === 2 ? "form-step active" : "form-step"} aria-hidden={step !== 2}>
        <div className="two-field-row">
          <label><span>Date of birth</span><input name="dateOfBirth" type="date" max="2010-12-31" /></label>
          <label><span>Gender</span><select name="gender" defaultValue=""><option value="">Choose an option</option><option>Female</option><option>Male</option><option>Prefer not to say</option></select></label>
        </div>
        <div className="two-field-row">
          <label><span>Preferred language</span><select name="preferredLanguage" defaultValue="English"><option>English</option><option>Mandarin</option><option>Malay</option><option>Tamil</option></select></label>
          <label><span>Where do you live?</span><input name="area" autoComplete="postal-code" placeholder="Area or postal code" /></label>
        </div>
        <ProfilePhotoPicker preview={photoPreview} onChange={setPhoto} />
      </section>

      <section className={step === 3 ? "form-step active" : "form-step"} aria-hidden={step !== 3}>
        <fieldset className="choice-field"><legend>Interests</legend><div className="choice-chips">{interestOptions.map((interest) => <button className={interests.includes(interest) ? "selected" : ""} type="button" key={interest} onClick={() => setInterests((items) => items.includes(interest) ? items.filter((item) => item !== interest) : [...items, interest])}>{interest}</button>)}</div></fieldset>
        <div className="two-field-row"><label><span>Preferred group size</span><select name="groupSize" defaultValue="small"><option value="one-to-one">One-to-one</option><option value="small">Small group (2–4)</option><option value="any">No preference</option></select></label><label><span>Activity level</span><select name="activityLevel" defaultValue="gentle"><option value="gentle">Gentle</option><option value="moderate">Moderate</option><option value="any">No preference</option></select></label></div>
      </section>

      <div className="register-actions">
        {step > 1 ? <button className="secondary-button" type="button" onClick={() => { setError(""); setStep((value) => value - 1); }}>Back</button> : null}
        <button className="primary-button" disabled={busy || usernameAvailability === "checking"}>{busy ? "Creating account…" : step === 3 ? "Create My Account" : "Next"}</button>
      </div>
      <p className="auth-switch">Already have an account? <Link href="/login">Log in</Link></p>
    </form>
  );
}

export function ProfilePhotoPicker({ preview, onChange }: { preview: string | null; onChange: (file: File | null) => void }) {
  return <label className="profile-upload-field"><span>Profile photo (optional)</span><span className="profile-upload-control">{preview ? <Image src={preview} alt="Selected profile preview" width={64} height={64} unoptimized /> : <b aria-hidden="true">📷</b>}<span><strong>{preview ? "Change photo" : "Add a photo"}</strong><small>JPG, PNG, or WebP · maximum 5 MB</small></span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => onChange(event.target.files?.[0] ?? null)} /></span></label>;
}

async function uploadAvatar(file: File) {
  const form = new FormData();
  form.set("photo", file);
  const response = await fetch("/api/profile/avatar", { method: "POST", body: form });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Could not upload that photo");
}

function PasswordField({ name, visible, onToggle, autoComplete }: { name: string; visible: boolean; onToggle: () => void; autoComplete: string }) {
  return <span className="password-field"><Icon name="lock" size={21} /><input name={name} type={visible ? "text" : "password"} autoComplete={autoComplete} minLength={8} maxLength={128} placeholder={autoComplete === "new-password" ? "8+ characters" : "Enter your password"} required /><button type="button" onClick={onToggle} aria-label={visible ? "Hide password" : "Show password"}><Icon name={visible ? "eye-off" : "eye"} size={20} /></button></span>;
}

function GoogleMark() {
  return <span className="google-mark" aria-hidden="true">G</span>;
}

function AuthDivider({ label = "or" }: { label?: string }) {
  return <div className="auth-divider"><span>{label}</span></div>;
}

function valueOf(form: HTMLFormElement, name: string) {
  return (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
}

function friendlyAuthError(message?: string) {
  if (!message) return "We couldn’t complete that request";
  if (/username.*taken|already.*username/i.test(message)) return "That display name is already taken.";
  if (/invalid.*password|invalid.*email|credential/i.test(message)) return "The email, display name, or password is incorrect.";
  if (/user.*exist/i.test(message)) return "An account already exists for that email.";
  return message;
}

function availabilityCopy(state: Availability) {
  if (state === "checking") return "Checking availability…";
  if (state === "available") return "Display name is available ✓";
  if (state === "taken") return "That display name is already taken";
  return "Friends can search for this name to message you.";
}
