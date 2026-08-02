import { redirect } from "next/navigation";
import { AuthBrand } from "@/components/auth-brand";
import { AuthForm } from "@/components/auth-form";
import { isGoogleAuthEnabled } from "@/lib/auth";
import { currentUser } from "@/server/identity/session";

export const metadata = { title: "Log in" };

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(user.onboardingComplete ? "/home" : "/register/complete");
  return <div className="auth-layout"><AuthBrand /><div className="auth-card"><AuthForm mode="login" googleEnabled={isGoogleAuthEnabled} /></div></div>;
}
