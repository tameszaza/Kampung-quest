import { ActivitiesPage } from "@/components/activities-page";

export default async function QuestsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const initialTab = tab === "Invited" || tab === "Notifications" ? tab : "Suggested";
  return <ActivitiesPage initialTab={initialTab} />;
}
