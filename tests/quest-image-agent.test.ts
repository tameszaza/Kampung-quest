import { describe, expect, it } from "vitest";
import { GeminiQuestImageAgent } from "@/server/agents/quest-image-agent";
import { LocalQuestImageStorage } from "@/server/quest/quest-image-storage";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const quest = {
  title: "Gentle garden chat",
  questType: "conversation",
  sharedGoal: "Meet neighbours over a calm afternoon",
  description: "Share stories and tend a few herbs together.",
  needsAddressed: ["companionship"],
  durationMinutes: 60,
  groupSize: 3,
  venueRequirements: ["step-free garden"],
  proposedTimeWindow: {
    start: "2026-08-05T03:00:00.000Z",
    end: "2026-08-05T04:00:00.000Z",
  },
};

describe("Gemini quest image agent", () => {
  it("requests an image with the existing server key and parses inline image data", async () => {
    let request: RequestInit | undefined;
    const agent = new GeminiQuestImageAgent({
      apiKey: "server-only-key",
      model: "gemini-test-image",
      baseURL: "https://generativelanguage.googleapis.com/v1/",
      fetch: async (_input, init) => {
        request = init;
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: {
            mimeType: "image/png",
            data: Buffer.from("fake-image").toString("base64"),
          } }] } }],
        }), { status: 200 });
      },
    });

    const result = await agent.generate({ quest });

    expect(result?.mimeType).toBe("image/png");
    expect(result?.bytes.toString()).toBe("fake-image");
    expect(request?.headers).toMatchObject({ "x-goog-api-key": "server-only-key" });
    const body = String(request?.body);
    expect(body).toContain("Do not include text");
    expect(body).toContain("Gentle garden chat");
    expect(body).toContain('"aspectRatio":"16:9"');
    expect(body).toContain('"imageSize":"1K"');
  });

  it("returns null for a provider response without image data", async () => {
    const agent = new GeminiQuestImageAgent({
      apiKey: "key",
      model: "gemini-test-image",
      baseURL: "https://example.test/v1",
      fetch: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "no image" }] } }] }), { status: 200 }),
    });

    await expect(agent.generate({ quest })).resolves.toBeNull();
  });

  it("waits and retries a temporary rate limit, but does not retry a daily quota", async () => {
    let attempts = 0;
    const retrying = new GeminiQuestImageAgent({
      apiKey: "key",
      model: "gemini-test-image",
      baseURL: "https://example.test/v1",
      minRequestIntervalMs: 0,
      maxRetryDelayMs: 1_000,
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) return new Response("retry in 0s", { status: 429, headers: { "retry-after": "0" } });
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: {
          mimeType: "image/png", data: Buffer.from("retried").toString("base64"),
        } }] } }] }), { status: 200 });
      },
    });
    await expect(retrying.generate({ quest })).resolves.toMatchObject({ mimeType: "image/png" });
    expect(attempts).toBe(2);

    attempts = 0;
    const daily = new GeminiQuestImageAgent({
      apiKey: "key",
      model: "gemini-test-image",
      baseURL: "https://example.test/v1",
      minRequestIntervalMs: 0,
      fetch: async () => {
        attempts += 1;
        return new Response("daily quota exhausted", { status: 429 });
      },
    });
    await expect(daily.generate({ quest })).resolves.toBeNull();
    expect(attempts).toBe(1);
  });
});

describe("quest image storage", () => {
  it("creates a stable optimized WebP and serves it by an opaque key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quest-images-"));
    const storage = new LocalQuestImageStorage(directory);
    const source = await (await import("sharp")).default({
      create: { width: 20, height: 20, channels: 3, background: { r: 20, g: 150, b: 100 } },
    }).png().toBuffer();
    const url = await storage.save({ bytes: source, mimeType: "image/png", model: "test" });
    const key = url.split("/").pop()!;
    const optimized = await storage.read(key);

    expect(url).toMatch(/^\/api\/quest-images\/[a-f0-9]{40}$/);
    expect(optimized.subarray(0, 4).toString()).toBe("RIFF");
    expect((await readFile(join(directory, `${key}.webp`))).equals(optimized)).toBe(true);
  });
});
