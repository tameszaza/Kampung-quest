import type { CandidateProfile, QuestProposal, SafetyReview } from "@/server/domain/schemas";

const moneyOrAmount = String.raw`(?:cash|money|payments?|\$\s?\d+(?:\.\d{2})?|\d+(?:\.\d{2})?\s+dollars?)`;
const lendingAction = String.raw`(?:loans?|lend(?:s|ing)?|lent|borrow(?:s|ed|ing)?)`;
const moneyAction = String.raw`(?:giv(?:e|es|ing)|send(?:s|ing)?|sent|transfer(?:s|red|ring)?|collect(?:s|ed|ing)?|handl(?:e|es|ed|ing)|${lendingAction}|pay(?:s|ing)?|paid|request(?:s|ed|ing)?|receiv(?:e|es|ed|ing))`;

const MONEY_ACTION_PATTERN = new RegExp(String.raw`\b${moneyAction}\b.{0,40}${moneyOrAmount}`, "i");
const MONEY_OPERATION_PATTERN = /\b(?:cash|money|payments?)\b.{0,20}\b(?:collection|transfer(?:s|red|ring)?|handling)\b/i;
const LENDING_RELATIONSHIP_PATTERN = new RegExp(
  String.raw`\b${lendingAction}\b.{0,30}\b(?:to|from)\s+(?:another\s+)?(?:participants?|members?|neighbou?rs?|friends?|someone|somebody)\b`,
  "i",
);
const NAMED_LENDING_RELATIONSHIP_PATTERN = /\b(?:[Ll]oans?|[Ll]end(?:s|ing)?|[Ll]ent|[Bb]orrow(?:s|ed|ing)?)\b.{0,30}\b(?:to|from)\s+[A-Z][a-z]+\b/;
const EDUCATIONAL_CONTEXT_PATTERN = /\b(?:learn|teach|lesson|workshop|explain|understand|education|literacy|demonstrat(?:e|es|ed|ing)|practi[cs](?:e|es|ed|ing))\b/i;
const TRANSACTION_MARKER_PATTERN = /(?:\$\s?\d+(?:\.\d{2})?|\d+(?:\.\d{2})?\s+dollars?|\b(?:participants?|members?|neighbou?rs?|friends?|someone|somebody|me|you|him|her|them|each person|each other)\b)/i;

const PRIVATE_HOME_PATTERNS = [
  /\b(?:home visits?|private homes?)\b/i,
  /\b(?:participants?|members?|neighbou?rs?|someone|their|his|her|my)(?:'s|')?\s+(?:home|house|apartment|flat)\b/i,
  /\b[A-Z][a-z]+(?:'s|’s)\s+(?:home|house|apartment|flat)\b/,
  /\b(?:meet|gather|host)\b.{0,20}\b(?:at|in)\s+(?:the\s+)?(?:home|house|apartment|flat)(?:\b\s+(?:for|with)\b|[.!?,]|$)/i,
];

function requiresMoneyReview(content: string): boolean {
  const mentionsMoneyOperation = MONEY_ACTION_PATTERN.test(content)
    || MONEY_OPERATION_PATTERN.test(content)
    || LENDING_RELATIONSHIP_PATTERN.test(content)
    || NAMED_LENDING_RELATIONSHIP_PATTERN.test(content);
  if (!mentionsMoneyOperation) return false;
  return !EDUCATIONAL_CONTEXT_PATTERN.test(content)
    || TRANSACTION_MARKER_PATTERN.test(content);
}

export class SafetyGuardianService {
  review(proposal: QuestProposal, profiles: Map<string, CandidateProfile>): SafetyReview {
    const content = `${proposal.quest.title} ${proposal.quest.description}`;
    const needsReview =
      requiresMoneyReview(content) ||
      PRIVATE_HOME_PATTERNS.some((pattern) => pattern.test(content)) ||
      proposal.proposedParticipants.some((participant) => !profiles.has(participant.candidateId));

    if (needsReview) {
      return {
        status: "human_review",
        riskLevel: "medium",
        conditions: ["A human coordinator must review the flagged proposal."],
        requiresHumanReview: true,
      };
    }

    return {
      status: "approved",
      riskLevel: "low",
      conditions: [
        "Do not share participant phone numbers.",
        "Ask for consent before sharing display names.",
        "Use coordinator verification at completion.",
      ],
      requiresHumanReview: false,
    };
  }
}
