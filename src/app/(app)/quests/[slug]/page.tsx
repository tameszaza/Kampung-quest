import { notFound } from "next/navigation";
import { QuestDetail } from "@/components/quest-detail";
import { getQuest, quests } from "@/data/mock-data";

export function generateStaticParams() {
  return quests.map((quest) => ({ slug: quest.slug }));
}

export default async function QuestDetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const quest = getQuest(slug);
  if (!quest) notFound();
  return <QuestDetail quest={quest} />;
}
