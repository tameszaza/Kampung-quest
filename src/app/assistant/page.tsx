import { redirect } from "next/navigation";
import { currentUser } from "@/server/identity/session";

export default async function AssistantPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/messages%3Fassistant%3D1");
  if (!user.onboardingComplete) redirect("/register/complete");
  redirect("/messages?assistant=1");
}
