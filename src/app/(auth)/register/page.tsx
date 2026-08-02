import { redirect } from "next/navigation";
import { AuthBrand } from "@/components/auth-brand";
import { AuthForm } from "@/components/auth-form";
import { isGoogleAuthEnabled } from "@/lib/auth";
import { currentUser } from "@/server/identity/session";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  const user = await currentUser();
  if (user) redirect(user.onboardingComplete ? "/home" : "/register/complete");
  return <div className="auth-layout register-layout"><AuthBrand compact /><div className="auth-card"><AuthForm mode="register" googleEnabled={isGoogleAuthEnabled} /></div></div>;
}
