import { redirect } from "next/navigation";
import { AuthBrand } from "@/components/auth-brand";
import { ProfileCompletionForm } from "@/components/profile-completion-form";
import { currentUser } from "@/server/identity/session";

export const metadata = { title: "Complete your profile" };

export default async function CompleteRegistrationPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/register/complete");
  if (user.onboardingComplete) redirect("/home");
  return <div className="auth-layout register-layout completion-layout"><AuthBrand compact /><div className="auth-card"><ProfileCompletionForm user={user} /></div></div>;
}
