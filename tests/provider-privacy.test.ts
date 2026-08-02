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
      narrative: "My name is Alice Tan. Call +65 9123 4567 or me@example.com near 12 Example Road for candidate_123.",
    });
    expect(minimized.narrative).not.toContain("Alice Tan");
    expect(minimized.narrative).not.toContain("9123");
    expect(minimized.narrative).not.toContain("me@example.com");
    expect(minimized.narrative).not.toContain("12 Example Road");
    expect(minimized.narrative).not.toContain("candidate_123");
  });
});
