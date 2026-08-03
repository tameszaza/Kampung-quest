import { ActivitiesPage } from "@/components/activities-page";

export default async function QuestsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <ActivitiesPage initialTab={tab === "Invited" ? "Invited" : "Suggested"} />;
}
