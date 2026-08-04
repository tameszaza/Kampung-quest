import type {
  AvailabilityWindow,
  CandidateProfile,
  Participant,
  QuestProposal,
  RetrievedCandidate,
} from "@/server/domain/schemas";

export class QuestSynthesisService {
  synthesize(initiator: CandidateProfile, candidates: RetrievedCandidate[]): QuestProposal {
    const selectedProfiles = this.selectCompatibleGroup(initiator, candidates);
    if (selectedProfiles.length < 1) throw new Error("No eligible participant is available for a quest draft");

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

  private selectCompatibleGroup(initiator: CandidateProfile, candidates: RetrievedCandidate[]): CandidateProfile[] {
    const selected = [initiator];
    for (const candidate of candidates) {
      const trial = [...selected, candidate.profile];
      const maximum = Math.min(...trial.map((profile) => profile.constraints.maximumGroupSize));
      if (trial.length <= maximum && this.sharedWindow(trial)) selected.push(candidate.profile);
      if (selected.length === 5) break;
    }
    return selected;
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
