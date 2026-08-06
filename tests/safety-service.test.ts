import { describe, expect, it } from "vitest";
import type { CandidateProfile, QuestProposal } from "@/server/domain/schemas";
import { SafetyGuardianService } from "@/server/features/safety-service";

const profiles = new Map<string, CandidateProfile>([["candidate_001", {
  candidateId: "candidate_001",
} as CandidateProfile]]);

function proposal(title: string, description: string): QuestProposal {
  return {
    quest: {
      title,
      questType: "learning",
      sharedGoal: "Learn together",
      description,
      needsAddressed: [],
      durationMinutes: 60,
      groupSize: 1,
      venueRequirements: ["approved_public_location"],
      proposedTimeWindow: {
        start: "2026-08-07T02:00:00.000Z",
        end: "2026-08-07T03:00:00.000Z",
      },
    },
    proposedParticipants: [{
      candidateId: "candidate_001",
      proposedRole: "participant",
      needsAddressed: [],
      contributionsUsed: [],
    }],
    reserveCandidates: [],
    mutualBenefitExplanation: [],
    confidence: 0.9,
  };
}

describe("SafetyGuardianService", () => {
  it("approves educational quests that mention digital or cashless payments", () => {
    const review = new SafetyGuardianService().review(
      proposal(
        "Learn QR payments",
        "Practise safe cashless payment at the community library.",
      ),
      profiles,
    );

    expect(review.status).toBe("approved");
    expect(review.requiresHumanReview).toBe(false);
  });

  it("approves public financial-literacy lessons without a concrete transaction", () => {
    const review = new SafetyGuardianService().review(
      proposal(
        "Understand loans",
        "Learn how borrowing money and handling cash work at the community library.",
      ),
      profiles,
    );

    expect(review.status).toBe("approved");
  });

  it("still requires review for lending or peer-to-peer money handling", () => {
    const guardian = new SafetyGuardianService();

    expect(guardian.review(
      proposal("Neighbourhood loan help", "Help a neighbour borrow money."),
      profiles,
    ).status).toBe("human_review");
    expect(guardian.review(
      proposal("Shared shopping", "Collect cash from each participant."),
      profiles,
    ).status).toBe("human_review");
    expect(guardian.review(
      proposal("Send funds", "Ask participants to send me money before the meetup."),
      profiles,
    ).status).toBe("human_review");
    expect(guardian.review(
      proposal("Pay a neighbour", "Pay Alex $20 before the meetup."),
      profiles,
    ).status).toBe("human_review");
    expect(guardian.review(
      proposal("Request funds", "Request money from participants."),
      profiles,
    ).status).toBe("human_review");
    expect(guardian.review(
      proposal("Receive funds", "Receive cash from each member."),
      profiles,
    ).status).toBe("human_review");
    expect(guardian.review(
      proposal("Personal loan", "Alice will lend to Bob before the meetup."),
      profiles,
    ).status).toBe("human_review");
    expect(guardian.review(
      proposal("Borrow supplies", "Borrow craft supplies from another participant."),
      profiles,
    ).status).toBe("approved");
  });

  it("still requires review for private-home plans and unknown participants", () => {
    const guardian = new SafetyGuardianService();

    expect(guardian.review(
      proposal("Friendly home visit", "Meet at a participant's private home."),
      profiles,
    ).status).toBe("human_review");
    expect(guardian.review(
      proposal("Friendly home visits", "Meet in participants' private homes."),
      profiles,
    ).status).toBe("human_review");
    expect(guardian.review(
      proposal("Neighbour meetup", "Gather in their apartment."),
      profiles,
    ).status).toBe("human_review");
    expect(guardian.review(
      proposal("Neighbour meetup", "Meet at Alice's house."),
      profiles,
    ).status).toBe("human_review");
    expect(guardian.review(
      proposal("Neighbour meetup", "Meet at home for lunch."),
      profiles,
    ).status).toBe("human_review");
    expect(guardian.review({
      ...proposal("Library meetup", "Meet at the public library."),
      proposedParticipants: [{
        candidateId: "candidate_unknown",
        proposedRole: "participant",
        needsAddressed: [],
        contributionsUsed: [],
      }],
    }, profiles).status).toBe("human_review");
  });

  it("requires review only when other high-risk categories are explicitly evidenced", () => {
    const guardian = new SafetyGuardianService();

    expect(guardian.review(
      proposal("Forced attendance", "Pressure a participant to attend against their will."),
      profiles,
    ).status).toBe("human_review");
    expect(guardian.review(
      proposal("Account setup", "Collect each participant's banking PIN during the session."),
      profiles,
    ).status).toBe("human_review");
    expect(guardian.review(
      proposal("Risky meetup", "Meet inside an abandoned building after dark."),
      profiles,
    ).status).toBe("human_review");

    expect(guardian.review(
      proposal("Confident cooking", "Encourage participants to try an ordinary public cooking class."),
      profiles,
    ).status).toBe("approved");
  });

  it("explains each trigger so a coordinator knows what must be reviewed", () => {
    const review = new SafetyGuardianService().review({
      ...proposal("Private payment", "Collect cash from each participant at Alice's house."),
      proposedParticipants: [{
        candidateId: "candidate_unknown",
        proposedRole: "participant",
        needsAddressed: [],
        contributionsUsed: [],
      }],
    }, profiles);

    expect(review.conditions).toEqual([
      "The plan includes participant-to-participant money handling.",
      "The plan proposes meeting in a private home.",
      "A proposed participant could not be verified.",
    ]);
  });
});
