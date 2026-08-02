import { redirect } from "next/navigation";
import { AssistantConversation } from "@/components/assistant-conversation";
import { currentUser } from "@/server/identity/session";
import { UserProvider } from "@/components/user-context";

export default async function AssistantPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/assistant");
  return <UserProvider initialUser={user}><AssistantConversation /></UserProvider>;
}
