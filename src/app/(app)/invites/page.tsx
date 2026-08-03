import { redirect } from "next/navigation";

export default function InvitesPage() {
  redirect("/quests?tab=Invited");
}
