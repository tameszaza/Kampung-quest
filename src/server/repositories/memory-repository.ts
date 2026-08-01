import type { MemoryCard } from "@/server/domain/schemas";

export interface MemoryRepository {
  save(card: MemoryCard): MemoryCard;
  find(candidateId: string): MemoryCard | undefined;
  list(): MemoryCard[];
  clear(): void;
}

export class InMemoryMemoryRepository implements MemoryRepository {
  private readonly cards = new Map<string, MemoryCard>();

  save(card: MemoryCard): MemoryCard {
    this.cards.set(card.profile.candidateId, structuredClone(card));
    return card;
  }

  find(candidateId: string): MemoryCard | undefined {
    const card = this.cards.get(candidateId);
    return card ? structuredClone(card) : undefined;
  }

  list(): MemoryCard[] {
    return [...this.cards.values()].map((card) => structuredClone(card));
  }

  clear(): void {
    this.cards.clear();
  }
}
