"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

type FormMode = "login" | "register";

const interestOptions = ["Cooking", "Gentle exercise", "Learning", "Games", "Gardening", "Conversation"];

export function AuthForm({ mode }: { mode: FormMode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [interests, setInterests] = useState<string[]>([]);

  function nextStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    if (step === 1) {
      const password = (form.elements.namedItem("password") as HTMLInputElement | null)?.value;
      const confirmation = (form.elements.namedItem("confirmPassword") as HTMLInputElement | null)?.value;
      if (password !== confirmation) {
        setError("The passwords do not match. Please try again.");
        return;
      }
    }
    setStep((value) => Math.min(3, value + 1));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = mode === "login"
      ? { identifier: form.get("identifier"), password: form.get("password"), rememberMe: form.get("rememberMe") === "on" }
      : {
          fullName: form.get("fullName"),
          email: form.get("email"),
          phone: form.get("phone"),
          password: form.get("password"),
          dateOfBirth: form.get("dateOfBirth"),
          gender: form.get("gender"),
          preferredLanguage: form.get("preferredLanguage"),
          area: form.get("area"),
          groupSize: form.get("groupSize"),
          activityLevel: form.get("activityLevel"),
          interests,
        };
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { error?: string; issues?: Array<{ message: string }> };
      if (!response.ok) throw new Error(result.issues?.[0]?.message ?? result.error ?? "Please try again");
      const requested = searchParams.get("next");
      router.replace(requested?.startsWith("/") ? requested : "/home");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We couldn’t complete that request");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "login") {
    return (
      <form className="auth-form" onSubmit={submit}>
        <header><h2>Welcome back</h2><p>Log in to connect with your community.</p></header>
        {error ? <div className="form-alert" role="alert">{error}</div> : null}
        <label>
          <span>Email or phone number</span>
          <input name="identifier" autoComplete="username" inputMode="email" placeholder="Email or phone number" required autoFocus />
        </label>
        <label>
          <span>Password</span>
          <span className="password-field">
            <input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Password" required />
            <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? "Hide" : "Show"}
            </button>
          </span>
        </label>
        <div className="auth-help-row"><label className="check-label"><input name="rememberMe" type="checkbox" defaultChecked /> Keep me signed in</label><span>Need help? Call 1800 555 010</span></div>
        <button className="primary-button auth-submit" disabled={busy}>{busy ? "Logging in…" : "Log In"}</button>
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
      {error ? <div className="form-alert" role="alert">{error}</div> : null}

      <section className={step === 1 ? "form-step active" : "form-step"} aria-hidden={step !== 1}>
        <label><span>Full name</span><input name="fullName" autoComplete="name" placeholder="Enter your full name" required={step === 1} /></label>
        <div className="two-field-row">
          <label><span>Email</span><input name="email" type="email" autoComplete="email" placeholder="you@example.com" /></label>
          <label><span>Phone number</span><input name="phone" type="tel" autoComplete="tel" placeholder="+65 9123 4567" /></label>
        </div>
        <label><span>Password</span><span className="password-field"><input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} pattern="(?=.*[A-Za-z])(?=.*[0-9]).{8,}" title="Use 8 or more characters with a letter and number" placeholder="8+ characters, with a letter and number" required={step === 1} /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></span></label>
        <label><span>Confirm password</span><input name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Type your password again" required={step === 1} /></label>
      </section>

      <section className={step === 2 ? "form-step active" : "form-step"} aria-hidden={step !== 2}>
        <label><span>Date of birth</span><input name="dateOfBirth" type="date" max="2010-12-31" /></label>
        <label><span>Gender</span><select name="gender" defaultValue=""><option value="">Choose an option</option><option>Female</option><option>Male</option><option>Prefer not to say</option></select></label>
        <label><span>Preferred language</span><select name="preferredLanguage" defaultValue="English"><option>English</option><option>Mandarin</option><option>Malay</option><option>Tamil</option></select></label>
        <label><span>Where do you live?</span><input name="area" autoComplete="postal-code" placeholder="Area or postal code" /></label>
      </section>

      <section className={step === 3 ? "form-step active" : "form-step"} aria-hidden={step !== 3}>
        <fieldset className="choice-field"><legend>Interests</legend><div className="choice-chips">{interestOptions.map((interest) => <button className={interests.includes(interest) ? "selected" : ""} type="button" key={interest} onClick={() => setInterests((items) => items.includes(interest) ? items.filter((item) => item !== interest) : [...items, interest])}>{interest}</button>)}</div></fieldset>
        <label><span>Preferred group size</span><select name="groupSize" defaultValue="small"><option value="one-to-one">One-to-one</option><option value="small">Small group (2–4)</option><option value="any">No preference</option></select></label>
        <label><span>Activity level</span><select name="activityLevel" defaultValue="gentle"><option value="gentle">Gentle</option><option value="moderate">Moderate</option><option value="any">No preference</option></select></label>
      </section>

      <div className="register-actions">
        {step > 1 ? <button className="secondary-button" type="button" onClick={() => { setError(""); setStep((value) => value - 1); }}>Back</button> : null}
        <button className="primary-button" disabled={busy}>{busy ? "Creating account…" : step === 3 ? "Create My Account" : "Next"}</button>
      </div>
      <p className="auth-switch">Already have an account? <Link href="/login">Log in</Link></p>
    </form>
  );
}
