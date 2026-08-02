import Image from "next/image";
import Link from "next/link";

export default function WelcomePage() {
  return (
    <main className="welcome-page">
      <section className="welcome-panel">
        <div className="welcome-copy">
          <div className="welcome-brand">
            <span className="brand-logo" aria-hidden="true">♥</span>
            <div>
              <h1>Senior Quest</h1>
              <p>Share. Connect. Enjoy Together.</p>
            </div>
          </div>

          <div className="welcome-mobile-art">
            <Image
              src="/assets/onboarding-seniors.png"
              alt="Two friendly senior community members"
              fill
              priority
              sizes="(max-width: 767px) 78vw, 430px"
            />
          </div>

          <div className="welcome-message">
            <h2>Let&apos;s create meaningful moments together.</h2>
            <p>Join activities, share your skills, and make new friends nearby.</p>
          </div>

          <div className="welcome-actions">
            <Link className="primary-button" href="/home">Get Started</Link>
            <Link className="secondary-button" href="/home">I Have an Account</Link>
          </div>

          <div className="pager-dots" aria-label="Onboarding page 1 of 3">
            <span className="active" />
            <span />
            <span />
          </div>
        </div>

        <div className="welcome-desktop-art" aria-hidden="true">
          <div className="welcome-art-circle">
            <Image
              src="/assets/onboarding-seniors.png"
              alt=""
              fill
              priority
              sizes="540px"
            />
          </div>
          <div className="welcome-principles">
            <span>Large & clear text</span>
            <span>Simple navigation</span>
            <span>Safe & trustworthy</span>
          </div>
        </div>
      </section>
    </main>
  );
}
