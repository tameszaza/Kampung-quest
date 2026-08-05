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
  venueAddress: z.string().min(1).nullable(),
  venueAddressOperation: z.enum(["unchanged", "set", "clear"]),
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
  const intent = output.intent;
  const requirementPatch = intent.type === "update_requirement"
    ? compactRequirements(output.requirementPatch)
    : {};
  let normalized: CoordinationIntent;
  switch (intent.type) {
    case "social":
      normalized = { type: "social" };
      break;
    case "question":
      normalized = { type: "question", topic: intent.topic ?? "other" };
      break;
    case "update_requirement":
      normalized = {
        type: "update_requirement",
        patch: requirementPatch,
        ...(intent.ambiguity ? { ambiguity: intent.ambiguity } : {}),
      };
      break;
    case "change_appointment":
      normalized = intent.appointmentPatch || intent.referencesSuggestionId
        ? {
            type: "change_appointment",
            patch: intent.appointmentPatch ? compactAppointmentPatch(intent.appointmentPatch) : {},
            ...(intent.referencesSuggestionId ? { referencesSuggestionId: intent.referencesSuggestionId } : {}),
          }
        : {
            type: "unsupported",
            reason: "The requested appointment change did not include a usable change",
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
      normalized = intent.action
        ? { type: "organizer_action", action: intent.action }
        : { type: "unsupported", reason: "The requested organizer action was unclear" };
      break;
    case "unsupported":
      normalized = {
        type: "unsupported",
        reason: intent.reason ?? "That request is not supported by activity coordination",
      };
      break;
  }
  return {
    reply: output.reply,
    requirementPatch,
    intent: coordinationIntentSchema.parse(normalized),
  };
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
  const { venueAddress, venueAddressOperation, ...fields } = patch;
  return {
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null)),
    ...(venueAddressOperation === "set" && venueAddress !== null ? { venueAddress } : {}),
    ...(venueAddressOperation === "clear" ? { venueAddress: null } : {}),
  };
}
