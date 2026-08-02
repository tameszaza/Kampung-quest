import { EngineQuestList } from "@/components/engine-quest-views";
import { PageHeader } from "@/components/page-header";

export default function QuestsPage() {
  return (
    <div className="page-container">
      <PageHeader title="Recommended Quests" />
      <p className="matched-copy">Safely matched for Maria <span aria-hidden="true">✨</span></p>
      <EngineQuestList />
    </div>
  );
}
