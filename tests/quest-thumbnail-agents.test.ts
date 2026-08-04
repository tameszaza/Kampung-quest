import { describe, expect, it } from "vitest";
import { FallbackQuestImageAgent } from "@/server/agents/fallback-quest-image-agent";
import { GeminiSvgThumbnailAgent } from "@/server/agents/gemini-svg-thumbnail-agent";
import { LocalQuestThumbnailAgent } from "@/server/agents/local-quest-thumbnail-agent";
import { LocalQuestImageStorage } from "@/server/quest/quest-image-storage";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const quest = {
  title: "Neighbourhood book club",
  questType: "conversation",
  sharedGoal: "Share stories with nearby readers",
  description: "A welcoming afternoon conversation about favourite books.",
  needsAddressed: ["companionship"],
  durationMinutes: 60,
  groupSize: 3,
  venueRequirements: ["step-free community room"],
  proposedTimeWindow: {
    start: "2026-08-05T03:00:00.000Z",
    end: "2026-08-05T04:00:00.000Z",
  },
};

describe("quest thumbnail providers", () => {
  it("uses the Gemini text model to create a safe SVG thumbnail", async () => {
    let requestedBody = "";
    const agent = new GeminiSvgThumbnailAgent({
      apiKey: "server-only-gemini-key",
      baseURL: "https://example.test/v1",
      model: "gemini-text-test",
      fetch: async (_input, init) => {
        requestedBody = String(init?.body);
        return new Response(JSON.stringify({
          choices: [{ message: { content: "```svg\n<svg width=\"1024\" height=\"576\" viewBox=\"0 0 1024 576\"><rect width=\"1024\" height=\"576\" fill=\"#dff5eb\"/><circle cx=\"400\" cy=\"250\" r=\"100\" fill=\"#0b795e\"/></svg>\n```" } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    const result = await agent.generate({ quest, variationKey: "gemini-svg" });

    expect(result?.model).toBe("gemini-text-test");
    expect(result?.mimeType).toBe("image/svg+xml");
    expect(result?.bytes.toString()).toContain("<svg");
    expect(requestedBody).toContain("self-contained SVG");
  });

  it("rejects unsafe SVG output from the text model", async () => {
    const agent = new GeminiSvgThumbnailAgent({
      apiKey: "key",
      baseURL: "https://example.test/v1",
      model: "gemini-text-test",
      fetch: async () => new Response(JSON.stringify({
        choices: [{ message: { content: "<svg width=\"1024\" height=\"576\" viewBox=\"0 0 1024 576\"><script>alert(1)</script></svg>" } }],
      }), { status: 200 }),
    });

    await expect(agent.generate({ quest })).resolves.toBeNull();
  });

  it("creates a deterministic, unique local illustration without a remote API", async () => {
    const agent = new LocalQuestThumbnailAgent();
    const first = await agent.generate({ quest, variationKey: "run-a" });
    const same = await agent.generate({ quest, variationKey: "run-a" });
    const different = await agent.generate({ quest, variationKey: "run-b" });

    expect(first?.model).toBe("local-quest-thumbnail");
    expect(first?.mimeType).toBe("image/svg+xml");
    expect(first?.bytes.length).toBeGreaterThan(500);
    expect(first?.bytes.equals(same!.bytes)).toBe(true);
    expect(first?.bytes.equals(different!.bytes)).toBe(false);
  });

  it("falls back to the local thumbnail when remote providers are unavailable", async () => {
    const fallback = new FallbackQuestImageAgent([
      { name: "remote", agent: { generate: async () => null } },
      { name: "local", agent: new LocalQuestThumbnailAgent() },
    ]);

    await expect(fallback.generate({ quest, variationKey: "fallback" })).resolves.toMatchObject({
      model: "local-quest-thumbnail",
      mimeType: "image/svg+xml",
    });
  });

  it("optimizes the local SVG fallback into the normal WebP storage path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quest-local-thumbnail-"));
    const generated = await new LocalQuestThumbnailAgent().generate({ quest, variationKey: "storage" });
    const url = await new LocalQuestImageStorage(directory).save(generated!);

    expect(url).toMatch(/^\/api\/quest-images\/[a-f0-9]{40}$/);
  });
});
