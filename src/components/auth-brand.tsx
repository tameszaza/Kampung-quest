import Image from "next/image";

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

