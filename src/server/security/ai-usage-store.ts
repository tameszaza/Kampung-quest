import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { AiControlError, type AiPolicy } from "@/server/security/ai-policy";

export const AI_CALL_TIMEOUT_MS = 90_000;
const LEASE_MS = 120_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface AiUsageStore {
  reserve(userId: string, costMicros: number, policy: AiPolicy): Promise<string>;
  release(leaseId: string): Promise<void>;
}

interface Bucket { requests: number; micros: number }

function windows(userId: string, now: number, policy: AiPolicy) {
  return [
    { scope: "global", period: "minute", duration: MINUTE_MS, maxRequests: policy.globalRequestsPerMinute, maxMicros: Infinity },
    { scope: `user:${userId}`, period: "minute", duration: MINUTE_MS, maxRequests: policy.userRequestsPerMinute, maxMicros: Infinity },
    { scope: "global", period: "day", duration: DAY_MS, maxRequests: Infinity, maxMicros: policy.globalDailyBudgetMicros },
    { scope: `user:${userId}`, period: "day", duration: DAY_MS, maxRequests: Infinity, maxMicros: policy.userDailyBudgetMicros },
  ].map((window) => ({ ...window, start: Math.floor(now / window.duration) * window.duration }));
}

function checkBucket(bucket: Bucket, window: ReturnType<typeof windows>[number], cost: number, now: number) {
  const retryAfter = Math.max(1, Math.ceil((window.start + window.duration - now) / 1_000));
  if (bucket.requests >= window.maxRequests) throw new AiControlError("AI_RATE_LIMITED", retryAfter);
  if (bucket.micros + cost > window.maxMicros) throw new AiControlError("AI_BUDGET_EXHAUSTED", retryAfter);
}

/** Development/test adapter only. Production admission is serialized in PostgreSQL. */
export class InMemoryAiUsageStore implements AiUsageStore {
  private readonly buckets = new Map<string, Bucket & { expires: number }>();
  private readonly leases = new Map<string, { userId: string; expires: number }>();
  constructor(private readonly clock = Date.now) {}

  async reserve(userId: string, costMicros: number, policy: AiPolicy): Promise<string> {
    const now = this.clock();
    for (const [key, bucket] of this.buckets) if (bucket.expires <= now) this.buckets.delete(key);
    for (const [key, lease] of this.leases) if (lease.expires <= now) this.leases.delete(key);
    if (this.leases.size >= policy.globalConcurrency
      || [...this.leases.values()].filter((lease) => lease.userId === userId).length >= policy.userConcurrency) {
      throw new AiControlError("AI_BUSY", 5);
    }
    const buckets = windows(userId, now, policy).map((window) => {
      const key = `${window.scope}:${window.period}:${window.start}`;
      const bucket = this.buckets.get(key) ?? { requests: 0, micros: 0, expires: window.start + window.duration };
      checkBucket(bucket, window, costMicros, now);
      return { key, bucket };
    });
    for (const { key, bucket } of buckets) this.buckets.set(key, {
      ...bucket, requests: bucket.requests + 1, micros: bucket.micros + costMicros,
    });
    const leaseId = randomUUID();
    this.leases.set(leaseId, { userId, expires: now + LEASE_MS });
    return leaseId;
  }

  async release(leaseId: string) { this.leases.delete(leaseId); }
}

export class PostgresAiUsageStore implements AiUsageStore {
  readonly pool: Pool;
  constructor(connectionString: string, pool?: Pool) {
    this.pool = pool ?? new Pool({ connectionString, max: 5, connectionTimeoutMillis: 3_000, query_timeout: 5_000 });
  }

  async reserve(userId: string, costMicros: number, policy: AiPolicy): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '3s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      // Every instance takes the same lock before checking and charging all scopes.
      await client.query("SELECT pg_advisory_xact_lock(724091, 19)");
      const time = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
      const now = time.rows[0].now.getTime();
      const instant = new Date(now).toISOString();
      await client.query("DELETE FROM security.ai_usage_leases WHERE expires_at <= $1", [instant]);
      await client.query("DELETE FROM security.ai_usage_buckets WHERE expires_at <= $1", [instant]);
      const concurrency = await client.query<{ total: string; own: string }>(
        "SELECT count(*) AS total, count(*) FILTER (WHERE user_scope = $1) AS own FROM security.ai_usage_leases",
        [`user:${userId}`],
      );
      if (Number(concurrency.rows[0].total) >= policy.globalConcurrency
        || Number(concurrency.rows[0].own) >= policy.userConcurrency) throw new AiControlError("AI_BUSY", 5);
      for (const window of windows(userId, now, policy)) {
        const start = new Date(window.start).toISOString();
        const result = await client.query<{ requests: number; reserved_micros: string }>(
          "SELECT requests, reserved_micros FROM security.ai_usage_buckets WHERE scope = $1 AND bucket_start = $2 AND period = $3",
          [window.scope, start, window.period],
        );
        const row = result.rows[0];
        checkBucket({ requests: row?.requests ?? 0, micros: Number(row?.reserved_micros ?? 0) }, window, costMicros, now);
        await client.query(
          `INSERT INTO security.ai_usage_buckets (scope, bucket_start, period, requests, reserved_micros, expires_at)
           VALUES ($1, $2, $3, 1, $4, $5)
           ON CONFLICT (scope, bucket_start, period) DO UPDATE
             SET requests = security.ai_usage_buckets.requests + 1,
                 reserved_micros = security.ai_usage_buckets.reserved_micros + EXCLUDED.reserved_micros`,
          [window.scope, start, window.period, costMicros, new Date(window.start + window.duration).toISOString()],
        );
      }
      const leaseId = randomUUID();
      await client.query("INSERT INTO security.ai_usage_leases (lease_id, user_scope, expires_at) VALUES ($1, $2, $3)",
        [leaseId, `user:${userId}`, new Date(now + LEASE_MS).toISOString()]);
      await client.query("COMMIT");
      return leaseId;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async release(leaseId: string) {
    await this.pool.query("DELETE FROM security.ai_usage_leases WHERE lease_id = $1", [leaseId]);
  }
}
