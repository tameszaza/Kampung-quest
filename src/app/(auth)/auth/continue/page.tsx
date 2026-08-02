import { redirect } from "next/navigation";
import { currentUser } from "@/server/identity/session";

export default async function ContinueAfterSignInPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  redirect(user.onboardingComplete ? "/home" : "/register/complete");
}
