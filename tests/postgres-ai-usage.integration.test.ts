import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readAiPolicy } from "@/server/security/ai-policy";
import { PostgresAiUsageStore } from "@/server/security/ai-usage-store";
import { createAiControlledFetch } from "@/server/security/ai-provider-fetch";

// This suite owns its database. Never opt in with a deployed/shared database URL.
const url = process.env.AI_LIMIT_TEST_DATABASE_URL;
const enabled = Boolean(url && process.env.AI_LIMIT_TEST_DATABASE_ISOLATED === "YES");
const first = enabled ? new PostgresAiUsageStore(url!) : null;
const second = enabled ? new PostgresAiUsageStore(url!) : null;
const policy = () => ({ ...readAiPolicy({}), userConcurrency: 100, globalConcurrency: 100,
  userRequestsPerMinute: 100, globalRequestsPerMinute: 100 });

describe.skipIf(!enabled)("shared PostgreSQL AI admission", () => {
  beforeAll(async () => {
    const host = new URL(url!).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) throw new Error("AI admission tests require an isolated local database");
    await first!.pool.query(readFileSync("db/migrations/019_ai_usage_limits.sql", "utf8"));
  });
  beforeEach(async () => {
    await first!.pool.query("TRUNCATE security.ai_usage_buckets, security.ai_usage_leases");
  });
  afterAll(async () => { await Promise.all([first?.pool.end(), second?.pool.end()]); });

  it("admits only the available daily budget under a race across two pools", async () => {
    const limits = { ...policy(), globalDailyBudgetMicros: 10, userDailyBudgetMicros: 100 };
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
      (i % 2 ? first! : second!).reserve(`member-${i}`, 2, limits)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    const denied = results.filter((result) => result.status === "rejected");
    expect(denied).toHaveLength(15);
    for (const result of denied) if (result.status === "rejected") expect(result.reason.code).toBe("AI_BUDGET_EXHAUSTED");
    const daily = await first!.pool.query("SELECT reserved_micros, requests FROM security.ai_usage_buckets WHERE scope = 'global' AND period = 'day'");
    expect(daily.rows[0]).toMatchObject({ reserved_micros: "10", requests: 5 });
  });

  it("enforces shared member rate limits with atomic rollback on denial", async () => {
    const limits = { ...policy(), userRequestsPerMinute: 3 };
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) =>
      (i % 2 ? first! : second!).reserve("same-member", 1, limits)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    const counts = await first!.pool.query("SELECT requests, reserved_micros FROM security.ai_usage_buckets WHERE scope = 'global'");
    expect(counts.rows).toHaveLength(2);
    for (const row of counts.rows) expect(row).toMatchObject({ requests: 3, reserved_micros: "3" });
  });

  it("enforces shared concurrency and recovers released and expired leases", async () => {
    const limits = { ...policy(), globalConcurrency: 1 };
    const lease = await first!.reserve("a", 1, limits);
    await expect(second!.reserve("b", 1, limits)).rejects.toMatchObject({ code: "AI_BUSY" });
    await second!.release(lease);
    const next = await second!.reserve("b", 1, limits);
    await first!.pool.query("UPDATE security.ai_usage_leases SET expires_at = now() - interval '1 second' WHERE lease_id = $1", [next]);
    await expect(first!.reserve("c", 1, limits)).resolves.toBeTypeOf("string");
    const count = await first!.pool.query("SELECT count(*) FROM security.ai_usage_leases");
    expect(count.rows[0].count).toBe("1");
  });

  it("retains spent allowance after lease release and across store recreation", async () => {
    const limits = { ...policy(), userDailyBudgetMicros: 5 };
    await first!.release(await first!.reserve("a", 5, limits));
    const restarted = new PostgresAiUsageStore(url!);
    try { await expect(restarted.reserve("a", 1, limits)).rejects.toMatchObject({ code: "AI_BUDGET_EXHAUSTED" }); }
    finally { await restarted.pool.end(); }
  });

  it("blocks provider calls when the admission migration is missing", async () => {
    await first!.pool.query("ALTER TABLE security.ai_usage_buckets RENAME TO ai_usage_buckets_unavailable");
    let calls = 0;
    try {
      const transport = createAiControlledFetch({ store: second!, policy: policy(), models: ["synthetic"],
        resolveActor: async () => "a", fetch: async () => { calls++; return Response.json({}); } });
      const response = await transport("https://provider.test/v1/responses", {
        method: "POST", body: JSON.stringify({ model: "synthetic", input: "Hello" }),
      });
      expect(response.status).toBe(503);
      expect(calls).toBe(0);
    } finally {
      await first!.pool.query("ALTER TABLE security.ai_usage_buckets_unavailable RENAME TO ai_usage_buckets");
    }
  });
});
