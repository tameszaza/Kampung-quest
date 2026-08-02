import type { CandidateProfile, MemoryCard } from "@/server/domain/schemas";
import type { MemoryRepository } from "@/server/repositories/memory-repository";

export class MemoryService {
  constructor(private readonly repository: MemoryRepository) {}

  remember(profile: CandidateProfile): MemoryCard {
    return this.repository.save({
      profile,
      markdown: this.toMarkdown(profile),
      updatedAt: new Date().toISOString(),
      version: 1,
      retrievalReady: false,
      narrative: profile.need,
    });
  }

  recall(candidateId: string): MemoryCard | undefined {
    return this.repository.find(candidateId);
  }

  private toMarkdown(profile: CandidateProfile): string {
    const interests = profile.interests.map((item) => `- ${item}`).join("\n") || "- Not specified";
    const offers = profile.offers.map((item) => `- ${item}`).join("\n") || "- Not specified";

    return [
      "---",
      `senior_id: ${profile.candidateId}`,
      "memory_type: active_need",
      `status: ${profile.memoryStatus}`,
      "---",
      "",
      "# Current need",
      "",
      profile.need,
      "",
      "# Interests",
      "",
      interests,
      "",
      "# What the senior can contribute",
      "",
      offers,
    ].join("\n");
  }
}
