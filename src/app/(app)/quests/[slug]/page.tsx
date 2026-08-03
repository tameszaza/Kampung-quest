import { EventQuestDetail } from "@/components/event-quest-detail";
import { QuestDetail } from "@/components/quest-detail";
import { quests } from "@/data/mock-data";

export default async function QuestDetailsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ from?: string }> }) {
  const { slug } = await params;
  const { from } = await searchParams;
  const showActivityActions = from !== "my-activities";
  const featuredQuest = quests.find((quest) => quest.slug === slug);
  if (featuredQuest) return <QuestDetail quest={featuredQuest} showActivityActions={showActivityActions} />;
  return <EventQuestDetail runId={slug} showActivityActions={showActivityActions} />;
}
