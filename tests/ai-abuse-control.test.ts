import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { AiControlError, readAiPolicy } from "@/server/security/ai-policy";
import { InMemoryAiUsageStore } from "@/server/security/ai-usage-store";
import { createAiControlledFetch } from "@/server/security/ai-provider-fetch";
import { errorResponse } from "@/server/http/responses";
import { hostedRetrySettings } from "@/server/agents/openai-agent-runtime";

const policy = () => ({ ...readAiPolicy({}), userConcurrency: 20, globalConcurrency: 100 });
const request = (extra: Record<string, unknown> = {}) => ({
  method: "POST", body: JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "Hello" }], ...extra }),
});
const url = "https://provider.test/v1/chat/completions";

describe("AI admission control", () => {
  it("shares limits across transports and rejects a burst before provider work", async () => {
    const limits = { ...policy(), userRequestsPerMinute: 3 };
    const store = new InMemoryAiUsageStore();
    const provider = vi.fn(async () => Response.json({ ok: true }));
    const options = { store, policy: limits, models: ["test-model"], resolveActor: async () => "member-1", fetch: provider };
    const firstInstance = createAiControlledFetch(options);
    const secondInstance = createAiControlledFetch(options);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? firstInstance : secondInstance)(url, request())));
    expect(results.filter((response) => response.ok)).toHaveLength(3);
    expect(results.filter((response) => response.status === 429)).toHaveLength(9);
    expect(provider).toHaveBeenCalledTimes(3);
    const denied = results.find((response) => response.status === 429)!;
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("keeps member limits separate and applies a shared global limit", async () => {
    const store = new InMemoryAiUsageStore();
    const limits = { ...policy(), userRequestsPerMinute: 1, globalRequestsPerMinute: 2 };
    await store.release(await store.reserve("a", 1, limits));
    await expect(store.reserve("a", 1, limits)).rejects.toMatchObject({ code: "AI_RATE_LIMITED" });
    await store.release(await store.reserve("b", 1, limits));
    await expect(store.reserve("c", 1, limits)).rejects.toMatchObject({ code: "AI_RATE_LIMITED" });
  });

  it("reserves both daily budgets atomically without charging rejected work", async () => {
    const store = new InMemoryAiUsageStore();
    const limits = { ...policy(), userDailyBudgetMicros: 10, globalDailyBudgetMicros: 15 };
    await store.release(await store.reserve("a", 10, limits));
    await expect(store.reserve("a", 1, limits)).rejects.toMatchObject({ code: "AI_BUDGET_EXHAUSTED" });
    await expect(store.reserve("b", 6, limits)).rejects.toMatchObject({ code: "AI_BUDGET_EXHAUSTED" });
    await store.release(await store.reserve("b", 5, limits));
    await expect(store.reserve("c", 1, limits)).rejects.toMatchObject({ code: "AI_BUDGET_EXHAUSTED" });
  });

  it("resets minute and daily windows and recovers expired leases", async () => {
    let now = Date.parse("2026-10-07T23:59:00Z");
    const store = new InMemoryAiUsageStore(() => now);
    const limits = { ...policy(), userConcurrency: 1, userRequestsPerMinute: 1, userDailyBudgetMicros: 10 };
    await store.reserve("a", 10, limits);
    await expect(store.reserve("a", 1, limits)).rejects.toMatchObject({ code: "AI_BUSY" });
    now += 120_001;
    await expect(store.reserve("a", 10, limits)).resolves.toBeTypeOf("string");
  });

  it("holds concurrency admission until the provider body completes", async () => {
    const store = new InMemoryAiUsageStore();
    let finish!: () => void;
    const provider = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { finish = () => { controller.enqueue(new TextEncoder().encode("{}")); controller.close(); }; },
    })));
    const transport = createAiControlledFetch({ store, policy: { ...policy(), userConcurrency: 1 },
      models: ["test-model"], resolveActor: async () => "a", fetch: provider });
    const first = transport(url, request());
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    expect((await transport(url, request())).status).toBe(429);
    finish();
    expect((await first).status).toBe(200);
    const third = transport(url, request());
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2));
    finish();
    expect((await third).status).toBe(200);
  });

  it("applies global concurrency across different members", async () => {
    const store = new InMemoryAiUsageStore();
    const limits = { ...policy(), globalConcurrency: 1 };
    const lease = await store.reserve("a", 1, limits);
    await expect(store.reserve("b", 1, limits)).rejects.toMatchObject({ code: "AI_BUSY" });
    await store.release(lease);
    await expect(store.reserve("b", 1, limits)).resolves.toBeTypeOf("string");
  });

  it("fails closed if the shared store is unavailable", async () => {
    const provider = vi.fn(async () => Response.json({}));
    const transport = createAiControlledFetch({ store: { reserve: async () => { throw new Error("database unavailable"); }, release: vi.fn() },
      policy: policy(), models: ["test-model"], resolveActor: async () => "a", fetch: provider });
    const response = await transport(url, request());
    expect(response.status).toBe(503);
    expect(response.headers.get("x-should-retry")).toBe("false");
    expect(provider).not.toHaveBeenCalled();
  });

  it("does not retry local budget denials through the real OpenAI SDK", async () => {
    const store = new InMemoryAiUsageStore();
    const reserve = vi.spyOn(store, "reserve");
    const provider = vi.fn(async () => Response.json({}));
    const transport = createAiControlledFetch({ store, policy: { ...policy(), globalDailyBudgetMicros: 1 },
      models: ["test-model"], resolveActor: async () => "a", fetch: provider });
    const client = new OpenAI({ apiKey: "synthetic", baseURL: "https://provider.test/v1", maxRetries: 3, fetch: transport });
    const error = await client.chat.completions.create({ model: "test-model", messages: [{ role: "user", content: "Hello" }] }).catch((error: unknown) => error);
    expect(error).toMatchObject({ status: 429, code: "AI_BUDGET_EXHAUSTED" });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(provider).not.toHaveBeenCalled();
    const response = errorResponse(error);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).not.toBeNull();
    for (const providerName of ["gemini", "openai"] as const) {
      const settings = hostedRetrySettings(providerName);
      expect(settings.policy?.({ error, normalized: { statusCode: 429, isNetworkError: false, isAbort: false },
        attempt: 1, maxRetries: 3, stream: false })).toBe(false);
    }
  });

  it("charges failed attempts and releases concurrency", async () => {
    const store = new InMemoryAiUsageStore();
    const limits = { ...policy(), userConcurrency: 1, userRequestsPerMinute: 1 };
    const provider = vi.fn(async () => { throw new Error("network failure after submission"); });
    const transport = createAiControlledFetch({ store, policy: limits, models: ["test-model"], resolveActor: async () => "a", fetch: provider });
    await expect(transport(url, request())).rejects.toThrow("network failure");
    const denied = await transport(url, request());
    expect((await denied.json()).error.code).toBe("AI_RATE_LIMITED");
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("admits each real SDK retry separately and stops it at the member limit", async () => {
    const store = new InMemoryAiUsageStore();
    const reserve = vi.spyOn(store, "reserve");
    const provider = vi.fn(async () => Response.json({ error: { message: "synthetic provider outage" } },
      { status: 503, headers: { "retry-after-ms": "1" } }));
    const transport = createAiControlledFetch({ store, policy: { ...policy(), userRequestsPerMinute: 1 },
      models: ["test-model"], resolveActor: async () => "a", fetch: provider });
    const client = new OpenAI({ apiKey: "synthetic", baseURL: "https://provider.test/v1", maxRetries: 3, fetch: transport });
    await expect(client.chat.completions.create({ model: "test-model", messages: [{ role: "user", content: "Hello" }] }))
      .rejects.toMatchObject({ code: "AI_RATE_LIMITED" });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(2);
  });

  it.each(["chat/completions", "responses", "embeddings"])("bounds output and reserves spend for %s", async (path) => {
    const store = new InMemoryAiUsageStore();
    const reserve = vi.spyOn(store, "reserve");
    const provider = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => Response.json(JSON.parse(String(init?.body))));
    const transport = createAiControlledFetch({ store, policy: { ...policy(), maxOutputTokens: 123 },
      models: ["test-model"], resolveActor: async () => "a", fetch: provider });
    const response = await transport(`https://provider.test/v1/${path}`, request({ max_output_tokens: 100_000, max_tokens: 100_000 }));
    const body = await response.json();
    if (path === "responses") expect(body.max_output_tokens).toBe(123);
    if (path === "chat/completions") expect(body.max_tokens).toBe(123);
    expect(reserve.mock.calls[0][1]).toBeGreaterThan(0);
    expect(reserve.mock.calls[0][0]).toBe("a");
  });

  it.each([
    { body: request({ stream: true }), status: 400 },
    { body: request({ model: "unconfigured-model" }), status: 400 },
    { body: request({ tools: [{ type: "web_search" }] }), status: 400 },
    { body: request({ messages: ["x".repeat(70_000)] }), status: 413 },
  ])("rejects unsupported/oversized work before spending ($status)", async ({ body, status }) => {
    const provider = vi.fn(async () => Response.json({}));
    const transport = createAiControlledFetch({ store: new InMemoryAiUsageStore(), policy: policy(),
      models: ["test-model"], resolveActor: async () => "a", fetch: provider });
    expect((await transport(url, body)).status).toBe(status);
    expect(provider).not.toHaveBeenCalled();
  });

  it("requires authentication even if the payload claims a different actor", async () => {
    const provider = vi.fn(async () => Response.json({}));
    const transport = createAiControlledFetch({ store: new InMemoryAiUsageStore(), policy: policy(),
      models: ["test-model"], resolveActor: async () => null, fetch: provider });
    expect((await transport(url, request({ userId: "trusted-user" }))).status).toBe(401);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "NaN", "Infinity", "", "1.5"])("rejects invalid policy configuration %s", (value) => {
    expect(() => readAiPolicy({ AI_USER_REQUESTS_PER_MINUTE: value })).toThrow();
  });

  it("preserves structured application errors in public HTTP responses", async () => {
    const response = errorResponse(new Error("wrapped", { cause: new AiControlError("AI_BUSY", 5) }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.json()).toMatchObject({ code: "AI_BUSY" });
  });
});
