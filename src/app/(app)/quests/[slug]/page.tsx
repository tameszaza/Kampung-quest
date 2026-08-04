import { EngineQuestDetail } from "@/components/engine-quest-views";
import { QuestDetail } from "@/components/quest-detail";
import { quests } from "@/data/mock-data";
import { currentUser } from "@/server/identity/session";
import { notFound } from "next/navigation";

export default async function QuestDetailsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ from?: string }> }) {
  const { slug } = await params;
  const { from } = await searchParams;
  const showActivityActions = from !== "my-activities";
  const featuredQuest = quests.find((quest) => quest.slug === slug);
  if (featuredQuest) {
    const user = await currentUser();
    if (user?.username !== "test") notFound();
    return <QuestDetail quest={featuredQuest} showActivityActions={showActivityActions} />;
  }
  return <EngineQuestDetail runId={slug} showActivityActions={showActivityActions} />;
}
