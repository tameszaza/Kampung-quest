import Image from "next/image";
import { Icon } from "@/components/icons";

export function AuthBrand({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`auth-brand-panel${compact ? " compact" : ""}`} aria-label="Senior Quest">
      <div className="auth-logo" aria-hidden="true"><span>♥</span></div>
      <div>
        <h1>Senior Quest</h1>
        <p>Share. Connect. Enjoy Together.</p>
      </div>
      {!compact ? (
        <>
          <div className="auth-illustration">
            <Image src="/assets/onboarding-seniors.png" alt="Two smiling senior friends" fill priority sizes="(max-width: 760px) 280px, 420px" />
          </div>
          <div className="auth-welcome-copy">
            <h2>Welcome back!</h2>
            <p>Let’s continue your journey to meaningful connections.</p>
          </div>
          <div className="senior-trust-row" aria-label="Senior-friendly design">
            <span><b>Aa</b> Large, clear text</span>
            <span><b>✓</b> Safe & secure</span>
            <span><b>♥</b> Friendly support</span>
          </div>
        </>
      ) : null}
    </section>
  );
}

/** Login-specific brand panel. It has a compact phone composition and a more
 * spacious desktop hero without changing the registration brand treatment. */
export function LoginBrand() {
  return (
    <section className="login-brand-panel" aria-label="Senior Quest">
      <div className="login-mobile-brand"><SeniorQuestMark /><strong>Senior Quest</strong></div>
      <div className="login-mobile-welcome">
        <h1>Welcome back!</h1>
        <p>Let&apos;s continue your journey<br />to meaningful connections.</p>
      </div>
      <div className="login-mobile-art"><Image src="/assets/onboarding-seniors.png" alt="Two smiling senior friends" fill priority sizes="(max-width: 767px) 280px, 360px" /></div>

      <div className="login-desktop-copy">
        <h1>Share.<br />Connect.<br />Enjoy Together.</h1>
        <span className="login-hero-heart" aria-hidden="true">♡</span>
        <p>Join activities, share your skills,<br />and build meaningful friendships<br />in your community.</p>
        <ul>
          <li><span><Icon name="connections" size={24} /></span><div><strong>Meaningful Connections</strong><small>Meet like-minded seniors<br />and make real friends.</small></div></li>
          <li><span><Icon name="calendar" size={24} /></span><div><strong>Enjoy Activities</strong><small>Join fun and engaging<br />activities together.</small></div></li>
          <li><span><Icon name="shield" size={24} /></span><div><strong>Safe &amp; Trusted Community</strong><small>A secure environment<br />where everyone belongs.</small></div></li>
        </ul>
      </div>
    </section>
  );
}

export function SeniorQuestMark() {
  return <span className="login-brand-mark" aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false"><circle cx="16" cy="7" r="3.5" /><circle cx="32" cy="7" r="3.5" /><path d="M11.5 20c0-5.5 3.6-9 8.2-9 1.8 0 3.4.7 4.3 2.1.9-1.4 2.5-2.1 4.3-2.1 4.6 0 8.2 3.5 8.2 9 0 7.6-6.2 13.7-12.5 18.8C17.7 33.7 11.5 27.6 11.5 20Z" /><path d="M24 34.5c-3-2.6-7-6.1-7-10.1 0-2.1 1.4-3.7 3.4-3.7 1.4 0 2.7.7 3.6 2 1-1.3 2.3-2 3.6-2 2 0 3.4 1.6 3.4 3.7 0 4-4 7.5-7 10.1Z" className="mark-cutout" /></svg></span>;
}
