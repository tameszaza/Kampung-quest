import { describe, expect, it } from "vitest";
import { GeminiSvgThumbnailAgent } from "@/server/agents/gemini-svg-thumbnail-agent";
import { RetryingQuestImageAgent } from "@/server/agents/retrying-quest-image-agent";
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

  it("retries a temporary provider failure without selecting a stock/local image", async () => {
    let attempts = 0;
    const retrying = new RetryingQuestImageAgent({
      generate: async () => {
        attempts += 1;
        return attempts === 3
          ? { bytes: Buffer.from("<svg />"), mimeType: "image/svg+xml", model: "gemini-text-test" }
          : null;
      },
    }, { delayMs: 0 });

    await expect(retrying.generate({ quest, variationKey: "retry" })).resolves.toMatchObject({
      model: "gemini-text-test",
    });
    expect(attempts).toBe(3);
  });

  it("optimizes a generated SVG into the normal WebP storage path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quest-thumbnail-"));
    const generated = {
      bytes: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1024\" height=\"576\" viewBox=\"0 0 1024 576\"><rect width=\"1024\" height=\"576\" fill=\"#dff5eb\"/></svg>"),
      mimeType: "image/svg+xml",
      model: "gemini-text-test",
    };
    const url = await new LocalQuestImageStorage(directory).save(generated!);

    expect(url).toMatch(/^\/api\/quest-images\/[a-f0-9]{40}$/);
  });
});
