import { redirect } from "next/navigation";
import Link from "next/link";
import { LoginBrand, SeniorQuestMark } from "@/components/auth-brand";
import { AuthForm } from "@/components/auth-form";
import { isGoogleAuthEnabled } from "@/lib/auth";
import { currentUser } from "@/server/identity/session";

export const metadata = { title: "Log in" };

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(user.onboardingComplete ? "/home" : "/register/complete");
  return (
    <div className="auth-layout login-layout">
      <header className="login-topbar">
        <Link className="login-topbar-brand" href="/login" aria-label="Senior Quest login"><SeniorQuestMark /><strong>Senior Quest</strong></Link>
        <p>New here? <Link href="/register">Create Account</Link></p>
      </header>
      <LoginBrand />
      <div className="auth-card"><AuthForm mode="login" googleEnabled={isGoogleAuthEnabled} /></div>
    </div>
  );
}
