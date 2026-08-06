import { MyQuestsPage } from "@/components/my-quests-page";
import { isActivityGroup } from "@/lib/my-activities";

export default async function MyQuestsRoute({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return <MyQuestsPage initialTab={isActivityGroup(tab) ? tab : "Awaiting coordination"} />;
}
