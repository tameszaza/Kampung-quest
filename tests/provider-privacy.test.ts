import { describe, expect, it } from "vitest";
import { minimizeProviderInput, stableFactRef } from "@/server/agents/provider-privacy";

describe("provider privacy boundary", () => {
  it("creates stable fact references without exposing fact text", () => {
    const first = stableFactRef("offer", "Can teach QR payment");
    const repeated = stableFactRef("offer", "  can teach qr payment  ");
    expect(first).toBe(repeated);
    expect(first).toMatch(/^offer_[a-f0-9]{16}$/);
    expect(first).not.toContain("payment");
  });

  it("redacts contact details, addresses, and internal participant IDs recursively", () => {
    const minimized = minimizeProviderInput({
      narrative: "Please call Mary Tan at +65 9123 4567 or me@example.com. Meet at Blk 123 Tampines St 45 #01-02, Singapore 529286 for candidate_123.",
      constraints: {
        availableWindows: [{
          start: "2026-08-03T03:00:00.000Z",
          end: "2026-08-03T06:00:00.000Z",
        }],
      },
    });
    expect(minimized.narrative).not.toContain("Mary Tan");
    expect(minimized.narrative).not.toContain("9123");
    expect(minimized.narrative).not.toContain("me@example.com");
    expect(minimized.narrative).not.toContain("Blk 123 Tampines St 45");
    expect(minimized.narrative).not.toContain("#01-02");
    expect(minimized.narrative).not.toContain("529286");
    expect(minimized.narrative).not.toContain("candidate_123");
    expect(minimized.constraints.availableWindows[0]).toEqual({
      start: "2026-08-03T03:00:00.000Z",
      end: "2026-08-03T06:00:00.000Z",
    });
  });
});
