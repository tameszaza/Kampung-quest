import { EngineQuestDetail } from "@/components/engine-quest-views";
import { QuestDetail } from "@/components/quest-detail";
import { quests } from "@/data/mock-data";

export default async function QuestDetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const featuredQuest = quests.find((quest) => quest.slug === slug);
  if (featuredQuest) return <QuestDetail quest={featuredQuest} />;
  return <EngineQuestDetail runId={slug} />;
}
