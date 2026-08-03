import { EngineQuestDetail } from "@/components/engine-quest-views";

export default async function QuestDetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <EngineQuestDetail runId={slug} />;
}
