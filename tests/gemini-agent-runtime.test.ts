import { describe, expect, it } from "vitest";
import { normalizeGeminiVenueRequirements } from "@/server/agents/openai-agent-runtime";

describe("Gemini agent output normalization", () => {
  it("maps descriptive public indoor venues to the validator's canonical requirements", () => {
    expect(normalizeGeminiVenueRequirements([
      "Indoor public community center media lounge",
      "Indoor seating",
      "Television or projector screen",
    ])).toEqual(expect.arrayContaining([
      "approved_public_location",
      "indoor",
    ]));
  });

  it("does not approve a venue merely because it is indoors", () => {
    expect(normalizeGeminiVenueRequirements(["Indoor private living room"]))
      .not.toContain("approved_public_location");
  });
});
