import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeApplicationAiControl, createApplicationAiFetch, withAiOperator } from "@/server/security/application-ai-control";
import { createConfiguredEmbeddingProvider } from "@/server/agents/configured-embedding-provider";
import { resolveProviderConfiguration } from "@/server/agents/provider-configuration";

const requestHeaders = new AsyncLocalStorage<Headers>();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.getStore() ?? new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async ({ headers }: { headers: Headers }) => {
  const id = headers.get("synthetic-authenticated-user");
  return id ? { user: { id } } : null;
} } } }));

const body = JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "Hello" }] });
const url = "https://provider.test/v1/chat/completions";

describe("application AI provider wiring", () => {
  afterEach(async () => { await closeApplicationAiControl(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("uses the authenticated request actor and retains it in a background continuation", async () => {
    vi.stubEnv("AI_USER_REQUESTS_PER_MINUTE", "1");
    const provider = vi.fn(async () => Response.json({ ok: true }));
    const first = createApplicationAiFetch(["test-model"], provider);
    const second = createApplicationAiFetch(["test-model"], provider);
    const pending = requestHeaders.run(new Headers({ "synthetic-authenticated-user": "alice" }), async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return first(url, { method: "POST", body });
    });
    expect((await pending).status).toBe(200);
    expect((await requestHeaders.run(new Headers({ "synthetic-authenticated-user": "alice" }), () =>
      second(url, { method: "POST", body }))).status).toBe(429);
    expect((await requestHeaders.run(new Headers({ "synthetic-authenticated-user": "bob" }), () =>
      second(url, { method: "POST", body }))).status).toBe(200);
    expect((await second(url, { method: "POST", body })).status).toBe(401);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("routes configured embeddings through the guard even without a web session", async () => {
    const provider = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", provider);
    const configuration = resolveProviderConfiguration({ AGENT_PROVIDER: "openai", OPENAI_API_KEY: "synthetic",
      OPENAI_BASE_URL: "https://provider.test/v1", OPENAI_EMBEDDING_MODEL: "test-model" });
    const embeddings = createConfiguredEmbeddingProvider(configuration);
    await expect(embeddings.embedMemory({ candidateId: "claimed-member", memoryVersion: 1,
      memory: { markdown: "", need: "companionship", interests: [], offers: [] } })).rejects.toMatchObject({ code: "AI_AUTH_REQUIRED" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("charges operator work against the global budget", async () => {
    vi.stubEnv("AI_GLOBAL_DAILY_BUDGET_USD", "0.000001");
    const provider = vi.fn(async () => Response.json({}));
    const transport = createApplicationAiFetch(["test-model"], provider);
    const response = await withAiOperator("reindex", () => transport(url, { method: "POST", body }));
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("AI_BUDGET_EXHAUSTED");
    expect(provider).not.toHaveBeenCalled();
  });

  it("refuses to reuse development in-memory counters in production", () => {
    createApplicationAiFetch(["test-model"]);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createApplicationAiFetch(["test-model"])).toThrow("requires PostgreSQL");
  });
});
