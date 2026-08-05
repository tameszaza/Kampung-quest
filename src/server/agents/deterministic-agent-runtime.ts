import type { AgentRuntime, MemoryAgentInput } from "@/server/agents/agent-runtime";
import type { MemoryAgentOutput } from "@/server/domain/schemas";
import { stableFactRef } from "@/server/agents/provider-privacy";
import { QuestSynthesisService } from "@/server/features/synthesis-service";
import { SafetyGuardianService } from "@/server/features/safety-service";

export class DeterministicAgentRuntime implements AgentRuntime {
  private readonly synthesis = new QuestSynthesisService();
  private readonly safety = new SafetyGuardianService();

  async conductConversation(
    input: Parameters<AgentRuntime["conductConversation"]>[0],
  ): ReturnType<AgentRuntime["conductConversation"]> {
    const requestedField = input.missingFields[0] ?? null;
    const prompts = {
      goal: "What would feel helpful or enjoyable for your next quest?",
      interests: "What interests would you like this quest to include?",
      offers: "Is there anything you would enjoy contributing?",
      availability: "When are you generally available? You can share several times or a weekly pattern; this will not schedule the activity yet.",
      group_size: "What group size would feel comfortable?",
      indoor: "Would you prefer an indoor setting?",
      stairs: "Are stairs comfortable for you?",
      distance: "How far would you be comfortable travelling?",
      language: "Which language should the group use?",
      consent: "May I use these details to look for suitable neighbours?",
    } as const;
    return {
      reply: requestedField ? prompts[requestedField] : "I have enough information to prepare your quest brief.",
      briefPatch: {},
      requestedField,
      suggestedReplies: [],
      status: requestedField ? "collecting" : "ready_for_review",
    };
  }

  async updateMemory(input: MemoryAgentInput): Promise<MemoryAgentOutput> {
    const { profile, narrative } = input;
    const previous = input.currentMemory?.profile;
    const need = input.providedSoftFacts?.need === false && previous ? previous.need : profile.need;
    const mergedInterests = input.providedSoftFacts?.interests === false && previous
      ? previous.interests
      : profile.interests;
    const mergedOffers = input.providedSoftFacts?.offers === false && previous
      ? previous.offers
      : profile.offers;
    const interests = mergedInterests.length > 0 ? mergedInterests : ["Not specified"];
    const offers = mergedOffers.length > 0 ? mergedOffers : ["Not specified"];

    return {
      need,
      interests: mergedInterests,
      offers: mergedOffers,
      markdown: [
        "---",
        `senior_id: ${profile.candidateId}`,
        `status: ${profile.memoryStatus}`,
        "---",
        "",
        "# Current need",
        "",
        need,
        "",
        "# Latest context",
        "",
        narrative,
        "",
        "# Interests",
        "",
        ...interests.map((item) => `- ${item}`),
        "",
        "# What the senior can contribute",
        "",
        ...offers.map((item) => `- ${item}`),
      ].join("\n"),
    };
  }

  async synthesizeQuest(
    input: Parameters<AgentRuntime["synthesizeQuest"]>[0],
  ): ReturnType<AgentRuntime["synthesizeQuest"]> {
    return {
      outcome: "proposal",
      proposal: this.synthesis.synthesize(input.initiator, input.candidates),
      primaryIntentRef: stableFactRef("need", input.initiator.need),
    };
  }

  async reviewSafety(
    input: Parameters<AgentRuntime["reviewSafety"]>[0],
  ): ReturnType<AgentRuntime["reviewSafety"]> {
    return this.safety.review(input.proposal, input.profiles);
  }

  async recoverQuest(
    input: Parameters<AgentRuntime["recoverQuest"]>[0],
  ): ReturnType<AgentRuntime["recoverQuest"]> {
    return {
      replacementCandidateId: input.run.proposal?.reserveCandidates[0]?.candidateId ?? null,
    };
  }

  async coordinateEvent(
    input: Parameters<AgentRuntime["coordinateEvent"]>[0],
  ): ReturnType<AgentRuntime["coordinateEvent"]> {
    const message = input.latestMessage.trim();
    const lower = message.toLowerCase();
    const requirementPatch: Awaited<ReturnType<AgentRuntime["coordinateEvent"]>>["requirementPatch"] = {};
    if (input.scope === "group" && /^(hi|hello|hey|thanks|thank you|sounds fun|looking forward)[!. ]*$/i.test(message)) {
      return { reply: "", requirementPatch, intent: { type: "social" } };
    }
    if (/^(yes[,! ]*|i |we )?(confirm|agree|approve)( this| it| the (plan|appointment))?[.! ]*$/i.test(message)
      || /^(looks|sounds) good( to me)?[.! ]*$/i.test(message)) {
      return {
        reply: "I will check and record your confirmation for the current appointment.",
        requirementPatch,
        intent: { type: "confirm_appointment", appointmentVersion: input.currentAppointment?.version ?? null },
      };
    }
    if (/\b(use|take|choose|go with|accept)\s+(that|the)\s+(option|suggestion|time|one)\b/i.test(message)
      && input.latestSuggestion) {
      return {
        reply: "I will recheck and apply that suggested option.",
        requirementPatch,
        intent: {
          type: "change_appointment",
          patch: {},
          referencesSuggestionId: input.latestSuggestion.suggestionId,
        },
      };
    }
    if (/\b(who|what|status|waiting|confirmed|next step)\b/.test(lower) && /\?|who|what|status|waiting/.test(lower)) {
      return {
        reply: "I will check the current activity state.",
        requirementPatch,
        intent: {
          type: "question",
          topic: /confirm|waiting|who/.test(lower) ? "confirmations" : "status",
        },
      };
    }
    if (/\b(cancel|call off)\b/.test(lower)) {
      return { reply: "I will check whether you can cancel this activity.", requirementPatch, intent: { type: "organizer_action", action: "cancel" } };
    }
    if (/\b(start|begin)\b.*\b(activity|quest)\b/.test(lower)) {
      return { reply: "I will check whether the activity can start.", requirementPatch, intent: { type: "organizer_action", action: "start" } };
    }
    if (/\b(complete|completed|finish|finished)\b.*\b(activity|quest)\b/.test(lower)) {
      return { reply: "I will check whether the activity can be completed.", requirementPatch, intent: { type: "organizer_action", action: "complete" } };
    }
    if (/\b(add|remove|replace)\b.*\b(person|participant|member|guest|roster)\b/.test(lower)) {
      return { reply: "I will check that roster request.", requirementPatch, intent: { type: "organizer_action", action: "change_roster" } };
    }
    const localTime = parseRequestedLocalTime(lower);
    const duration = /(?:for|duration(?: of)?)\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)/i.exec(message);
    const venueMatch = /(?:move|change|set|meet)(?: it| the activity)?(?: to| at)\s+(.+?)(?:\s+at\s+\d|[.!?]|$)/i.exec(message);
    const venueName = venueMatch?.[1] && !/^\d{1,2}(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)$/i.test(venueMatch[1].trim())
      ? venueMatch[1].trim()
      : null;
    if (localTime || duration || venueName) {
      const durationValue = duration
        ? Number(duration[1]) * (/hour|hr/i.test(duration[2]) ? 60 : 1)
        : undefined;
      return {
        reply: "I will check that requested change against the whole group's confirmed requirements.",
        requirementPatch,
        intent: {
          type: "change_appointment",
          patch: {
            ...(localTime ? { localTime } : {}),
            ...(durationValue ? { durationMinutes: durationValue } : {}),
            ...(venueName ? { venueName } : {}),
          },
        },
      };
    }
    if (/cannot|can't|unavailable|conflict|not free/.test(lower)) requirementPatch.temporaryConflicts = [message];
    if (/wheelchair|stairs|step-free|accessible|walking aid/.test(lower)) requirementPatch.accessibility = [message];
    if (/halal|vegetarian|vegan|allerg|diet/.test(lower)) requirementPatch.dietary = [message];
    if (/travel|distance|bus|taxi|walk/.test(lower)) requirementPatch.travel = [message];
    if (/venue|community centre|community center|library|park/.test(lower)) requirementPatch.venuePreferences = [message];
    if (Object.keys(requirementPatch).length === 0) requirementPatch.other = [message];
    return {
      reply: "I have prepared that as a private coordination requirement. Please confirm it before I use it to arrange the quest.",
      requirementPatch,
      intent: { type: "update_requirement", patch: requirementPatch },
    };
  }
}

function parseRequestedLocalTime(message: string): string | null {
  const match = /\b(?:at|to)\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(message);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3].toLowerCase().startsWith("p") ? "pm" : "am";
  if (hour < 1 || hour > 12) return null;
  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
