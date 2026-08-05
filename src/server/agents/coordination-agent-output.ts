import { z } from "zod";
import {
  coordinationIntentSchema,
  type CoordinationIntent,
  type CoordinationRequirements,
} from "@/server/domain/event-coordination";

const nullableStringListSchema = z.array(z.string().min(1)).nullable();

const providerAvailabilityWindowSchema = z.object({
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  timeZone: z.string().min(1).nullable(),
});

const providerAppointmentPatchSchema = z.object({
  start: z.iso.datetime({ offset: true }).nullable(),
  end: z.iso.datetime({ offset: true }).nullable(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  durationMinutes: z.number().int().min(15).max(120).nullable(),
  venueName: z.string().min(1).nullable(),
  venueAddress: z.string().nullable(),
});

export const coordinationProviderOutputSchema = z.object({
  reply: z.string().min(1),
  requirementPatch: z.object({
    availableWindows: z.array(providerAvailabilityWindowSchema).nullable(),
    accessibility: nullableStringListSchema,
    travel: nullableStringListSchema,
    dietary: nullableStringListSchema,
    environmental: nullableStringListSchema,
    venuePreferences: nullableStringListSchema,
    temporaryConflicts: nullableStringListSchema,
    other: nullableStringListSchema,
  }),
  intent: z.object({
    type: z.enum([
      "social",
      "question",
      "update_requirement",
      "change_appointment",
      "confirm_appointment",
      "reject_appointment",
      "organizer_action",
      "unsupported",
    ]),
    topic: z.enum(["status", "confirmations", "compatibility", "other"]).nullable(),
    appointmentPatch: providerAppointmentPatchSchema.nullable(),
    ambiguity: z.array(z.string().min(1)).nullable(),
    referencesSuggestionId: z.string().min(1).nullable(),
    appointmentVersion: z.number().int().positive().nullable(),
    reason: z.string().min(1).nullable(),
    action: z.enum(["change_roster", "cancel", "start", "complete"]).nullable(),
  }),
});

export type CoordinationProviderOutput = z.infer<typeof coordinationProviderOutputSchema>;

export function normalizeCoordinationProviderOutput(value: unknown): {
  reply: string;
  requirementPatch: Partial<CoordinationRequirements>;
  intent: CoordinationIntent;
} {
  const output = coordinationProviderOutputSchema.parse(value);
  const requirementPatch = compactRequirements(output.requirementPatch);
  const intent = output.intent;
  assertConsistentIntent(intent);
  let normalized: CoordinationIntent;
  switch (intent.type) {
    case "social":
      normalized = { type: "social" };
      break;
    case "question":
      if (!intent.topic) throw new Error("The coordination agent omitted the question topic");
      normalized = { type: "question", topic: intent.topic };
      break;
    case "update_requirement":
      normalized = {
        type: "update_requirement",
        patch: requirementPatch,
        ...(intent.ambiguity ? { ambiguity: intent.ambiguity } : {}),
      };
      break;
    case "change_appointment":
      if (!intent.appointmentPatch) throw new Error("The coordination agent omitted the appointment change");
      normalized = {
        type: "change_appointment",
        patch: compactAppointmentPatch(intent.appointmentPatch),
        ...(intent.referencesSuggestionId ? { referencesSuggestionId: intent.referencesSuggestionId } : {}),
      };
      break;
    case "confirm_appointment":
      normalized = { type: "confirm_appointment", appointmentVersion: intent.appointmentVersion };
      break;
    case "reject_appointment":
      normalized = {
        type: "reject_appointment",
        appointmentVersion: intent.appointmentVersion,
        ...(intent.reason ? { reason: intent.reason } : {}),
      };
      break;
    case "organizer_action":
      if (!intent.action) throw new Error("The coordination agent omitted the organizer action");
      normalized = { type: "organizer_action", action: intent.action };
      break;
    case "unsupported":
      if (!intent.reason) throw new Error("The coordination agent omitted the unsupported-request reason");
      normalized = { type: "unsupported", reason: intent.reason };
      break;
  }
  return {
    reply: output.reply,
    requirementPatch,
    intent: coordinationIntentSchema.parse(normalized),
  };
}

function assertConsistentIntent(intent: CoordinationProviderOutput["intent"]) {
  const allowed: Record<CoordinationProviderOutput["intent"]["type"], Array<keyof CoordinationProviderOutput["intent"]>> = {
    social: [],
    question: ["topic"],
    update_requirement: ["ambiguity"],
    change_appointment: ["appointmentPatch", "referencesSuggestionId"],
    confirm_appointment: ["appointmentVersion"],
    reject_appointment: ["appointmentVersion", "reason"],
    organizer_action: ["action"],
    unsupported: ["reason"],
  };
  const permitted = new Set<keyof CoordinationProviderOutput["intent"]>(["type", ...allowed[intent.type]]);
  const conflicting = Object.entries(intent).filter(([key, value]) =>
    key !== "type" && value !== null && !permitted.has(key as keyof CoordinationProviderOutput["intent"]));
  if (conflicting.length) throw new Error("The coordination agent returned inconsistent fields for its selected intent");
}

function compactRequirements(
  patch: CoordinationProviderOutput["requirementPatch"],
): Partial<CoordinationRequirements> {
  return Object.fromEntries(Object.entries(patch)
    .filter((entry): entry is [string, Exclude<typeof entry[1], null>] => entry[1] !== null)
    .map(([key, values]) => [key, key === "availableWindows"
      ? (values as Array<z.infer<typeof providerAvailabilityWindowSchema>>).map(({ timeZone, ...window }) => ({
          ...window,
          ...(timeZone ? { timeZone } : {}),
        }))
      : values])) as Partial<CoordinationRequirements>;
}

function compactAppointmentPatch(patch: z.infer<typeof providerAppointmentPatchSchema>) {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null));
}
