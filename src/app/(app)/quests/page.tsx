import { PageHeader } from "@/components/page-header";
import { QuestCard } from "@/components/quest-card";
import { quests } from "@/data/mock-data";

export default function QuestsPage() {
  return (
    <div className="page-container">
      <PageHeader title="Recommended Quests" />
      <p className="matched-copy">Matched for you <span aria-hidden="true">✨</span></p>
      <section className="quest-grid" aria-label="Recommended quests">
        {quests.map((quest) => <QuestCard key={quest.slug} quest={quest} />)}
      </section>
    </div>
  );
}
