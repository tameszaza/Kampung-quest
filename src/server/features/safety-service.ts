import type { CandidateProfile, QuestProposal, SafetyReview } from "@/server/domain/schemas";

const moneyOrAmount = String.raw`(?:cash|money|payments?|\$\s?\d+(?:\.\d{2})?|\d+(?:\.\d{2})?\s+dollars?)`;
const lendingAction = String.raw`(?:loans?|lend(?:s|ing)?|lent|borrow(?:s|ed|ing)?)`;
const moneyAction = String.raw`(?:giv(?:e|es|ing)|send(?:s|ing)?|sent|transfer(?:s|red|ring)?|collect(?:s|ed|ing)?|handl(?:e|es|ed|ing)|${lendingAction}|pay(?:s|ing)?|paid|request(?:s|ed|ing)?|receiv(?:e|es|ed|ing))`;

const MONEY_ACTION_PATTERN = new RegExp(String.raw`\b${moneyAction}\b.{0,40}${moneyOrAmount}`, "i");
const MONEY_OPERATION_PATTERN = /\b(?:cash|money|payments?)\b.{0,20}\b(?:collection|transfer(?:s|red|ring)?|handling)\b/i;
const PERSONAL_LOAN_PATTERN = /\bpersonal loans?\b/i;
const EDUCATIONAL_CONTEXT_PATTERN = /\b(?:learn|teach|lesson|workshop|explain|understand|education|literacy|demonstrat(?:e|es|ed|ing)|practi[cs](?:e|es|ed|ing))\b/i;
const TRANSACTION_MARKER_PATTERN = /(?:\$\s?\d+(?:\.\d{2})?|\d+(?:\.\d{2})?\s+dollars?|\b(?:participants?|members?|neighbou?rs?|friends?|someone|somebody|me|you|him|her|them|each person|each other)\b)/i;

const PRIVATE_HOME_PATTERNS = [
  /\b(?:home visits?|private homes?)\b/i,
  /\b(?:participants?|members?|neighbou?rs?|someone|their|his|her|my)(?:'s|')?\s+(?:home|house|apartment|flat)\b/i,
  /\b[A-Z][a-z]+(?:'s|’s)\s+(?:home|house|apartment|flat)\b/,
  /\b(?:meet|gather|host)\b.{0,20}\b(?:at|in)\s+(?:the\s+)?(?:home|house|apartment|flat)(?:\b\s+(?:for|with)\b|[.!?,]|$)/i,
];

const EVIDENT_RISK_PATTERNS: Array<{ pattern: RegExp; condition: string }> = [
  {
    pattern: /\b(?:force|forced|forcing|pressure|pressured|pressuring|coerce|coerced|coercing|threaten|threatened|threatening)\b.{0,50}\b(?:participant|member|neighbou?r|person|them|their|attend|join)\b/i,
    condition: "The plan explicitly describes coercion or pressure.",
  },
  {
    pattern: /\b(?:suicide|suicidal|self[- ]harm|overdose|medical emergency|acute distress)\b/i,
    condition: "The plan explicitly describes acute distress requiring specialist review.",
  },
  {
    pattern: /\b(?:collect|share|send|post|publish|request|record|write down)\b.{0,50}\b(?:password|passcode|pin|bank account|credit card|nric|passport|medical record|phone number|home address)\b/i,
    condition: "The plan explicitly requests sensitive personal information.",
  },
  {
    pattern: /\b(?:abandoned building|construction site|rail(?:way)? tracks?|active roadway|condemned building)\b/i,
    condition: "The plan explicitly proposes an unsafe venue.",
  },
];

function requiresMoneyReview(content: string): boolean {
  const mentionsMoneyOperation = MONEY_ACTION_PATTERN.test(content)
    || MONEY_OPERATION_PATTERN.test(content)
    || PERSONAL_LOAN_PATTERN.test(content);
  if (!mentionsMoneyOperation) return false;
  return !EDUCATIONAL_CONTEXT_PATTERN.test(content)
    || TRANSACTION_MARKER_PATTERN.test(content);
}

export class SafetyGuardianService {
  review(proposal: QuestProposal, profiles: Map<string, CandidateProfile>): SafetyReview {
    const content = `${proposal.quest.title} ${proposal.quest.description}`;
    const conditions: string[] = [];
    if (requiresMoneyReview(content)) {
      conditions.push("The plan includes participant-to-participant money handling.");
    }
    if (PRIVATE_HOME_PATTERNS.some((pattern) => pattern.test(content))) {
      conditions.push("The plan proposes meeting in a private home.");
    }
    if (proposal.proposedParticipants.some((participant) => !profiles.has(participant.candidateId))) {
      conditions.push("A proposed participant could not be verified.");
    }
    for (const risk of EVIDENT_RISK_PATTERNS) {
      if (risk.pattern.test(content)) conditions.push(risk.condition);
    }
    if (conditions.length > 0) {
      return {
        status: "human_review",
        riskLevel: "medium",
        conditions,
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
