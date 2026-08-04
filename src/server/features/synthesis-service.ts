import type {
  AvailabilityWindow,
  CandidateProfile,
  Participant,
  QuestProposal,
  RetrievedCandidate,
} from "@/server/domain/schemas";

export interface QuestSynthesisOptions {
  /** Participant combinations already shown to the initiating member. */
  avoidParticipantSets?: string[][];
}

export class QuestSynthesisService {
  synthesize(
    initiator: CandidateProfile,
    candidates: RetrievedCandidate[],
    options: QuestSynthesisOptions = {},
  ): QuestProposal {
    const selectedProfiles = this.selectCompatibleGroup(initiator, candidates, options.avoidParticipantSets ?? []);
    if (selectedProfiles.length < 2) throw new Error("No eligible candidates share an availability window");

    const window = this.sharedWindow(selectedProfiles);
    if (!window) throw new Error("No shared availability window was found");

    const selectedIds = new Set(selectedProfiles.map((profile) => profile.candidateId));
    const selectedScores = candidates.filter((candidate) => selectedIds.has(candidate.profile.candidateId));
    const interests = this.unique(selectedProfiles.flatMap((profile) => profile.interests));
    const needs = this.unique(selectedProfiles.map((profile) => profile.need));
    const focus = interests[0] ?? "community connection";
    const durationMinutes = Math.min(90, Math.floor((Date.parse(window.end) - Date.parse(window.start)) / 60_000));
    const venueRequirements = ["approved_public_location", "seating_available", "accessible_toilet"];
    if (selectedProfiles.some((profile) => profile.constraints.indoorRequired)) venueRequirements.push("indoor");
    if (selectedProfiles.some((profile) => !profile.constraints.stairsAllowed)) venueRequirements.push("no_stairs");

    return {
      quest: {
        title: `${this.titleCase(focus)} Kampung Quest`,
        questType: "community_activity",
        sharedGoal: "Connect neighbours through a useful, mutually supportive activity.",
        description: `A small public activity centred on ${focus} with a meaningful role for everyone.`,
        needsAddressed: needs,
        durationMinutes,
        groupSize: selectedProfiles.length,
        venueRequirements,
        proposedTimeWindow: window,
      },
      proposedParticipants: selectedProfiles.map((profile, index) => this.participant(profile, index)),
      reserveCandidates: candidates
        .filter((candidate) => !selectedIds.has(candidate.profile.candidateId))
        .slice(0, 3)
        .map((candidate) => ({
          candidateId: candidate.profile.candidateId,
          possibleRole: "supporting_participant",
          reason: "Eligible candidate with compatible needs, interests, or abilities.",
        })),
      mutualBenefitExplanation: selectedProfiles.map(
        (profile) => `${profile.candidateId} receives support for their need and contributes through an assigned role.`,
      ),
      confidence:
        selectedScores.length === 0
          ? 0.5
          : this.round(selectedScores.reduce((sum, candidate) => sum + candidate.scores.total, 0) / selectedScores.length),
    };
  }

  private selectCompatibleGroup(
    initiator: CandidateProfile,
    candidates: RetrievedCandidate[],
    avoidParticipantSets: string[][],
  ): CandidateProfile[] {
    // Rotate the ranked candidates for a new conversation. The first group is
    // still the best match; subsequent groups deliberately explore the next
    // compatible neighbours instead of returning the exact same roster.
    const attempts = Math.max(1, candidates.length);
    let fallback = [initiator];
    for (let offset = 0; offset < attempts; offset += 1) {
      const ordered = [...candidates.slice(offset), ...candidates.slice(0, offset)];
      const selected = [initiator];
      for (const candidate of ordered) {
        const trial = [...selected, candidate.profile];
        const maximum = Math.min(...trial.map((profile) => profile.constraints.maximumGroupSize));
        if (trial.length <= maximum && this.sharedWindow(trial)) selected.push(candidate.profile);
        if (selected.length === 5) break;
      }
      if (selected.length > fallback.length) fallback = selected;
      if (selected.length >= 2 && !this.isAvoidedSet(selected, avoidParticipantSets)) return selected;
    }
    return fallback;
  }

  private isAvoidedSet(profiles: CandidateProfile[], avoidParticipantSets: string[][]): boolean {
    const selected = profiles.map((profile) => profile.candidateId).sort().join("|");
    return avoidParticipantSets.some((set) => [...set].sort().join("|") === selected);
  }

  private sharedWindow(profiles: CandidateProfile[]): AvailabilityWindow | null {
    let intersections = [...profiles[0].constraints.availableWindows];
    for (const profile of profiles.slice(1)) {
      intersections = intersections.flatMap((left) =>
        profile.constraints.availableWindows.flatMap((right) => {
          const start = Math.max(Date.parse(left.start), Date.parse(right.start));
          const end = Math.min(Date.parse(left.end), Date.parse(right.end));
          return end - start >= 30 * 60_000
            ? [{ start: new Date(start).toISOString(), end: new Date(end).toISOString() }]
            : [];
        }),
      );
      if (intersections.length === 0) return null;
    }

    const best = intersections.sort(
      (left, right) => Date.parse(right.end) - Date.parse(right.start) - (Date.parse(left.end) - Date.parse(left.start)),
    )[0];
    return {
      start: best.start,
      end: new Date(Math.min(Date.parse(best.end), Date.parse(best.start) + 90 * 60_000)).toISOString(),
    };
  }

  private participant(profile: CandidateProfile, index: number): Participant {
    return {
      candidateId: profile.candidateId,
      proposedRole: index === 0 ? "quest_host" : `participant_${index}`,
      needsAddressed: [profile.need],
      contributionsUsed: [profile.offers[0] ?? "participate and support the group"],
    };
  }

  private unique(values: string[]): string[] {
    return [...new Set(values)];
  }

  private titleCase(value: string): string {
    return value.replace(/\b\w/g, (character) => character.toUpperCase());
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
