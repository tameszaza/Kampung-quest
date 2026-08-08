import { NextResponse } from "next/server";
import { kampungQuestEngine, kampungStore, runtimeConfiguration } from "@/server/container";

const HEALTH_CACHE_MS = 30_000;
type HealthSnapshot = Awaited<ReturnType<typeof readHealth>>;
let cachedHealth: { expiresAt: number; snapshot: HealthSnapshot } | null = null;
let healthCheckInFlight: Promise<HealthSnapshot> | null = null;

export async function GET() {
  const now = Date.now();
  if (cachedHealth && cachedHealth.expiresAt > now) return healthResponse(cachedHealth.snapshot, "HIT");
  healthCheckInFlight ??= readHealth().finally(() => { healthCheckInFlight = null; });
  const snapshot = await healthCheckInFlight;
  cachedHealth = { expiresAt: Date.now() + HEALTH_CACHE_MS, snapshot };
  return healthResponse(snapshot, "MISS");
}

async function readHealth() {
  const [readiness, embeddingIndex] = await Promise.all([
    kampungStore.healthCheck(),
    kampungQuestEngine.getEmbeddingIndexStatus(),
  ]);
  const ready = readiness.database
    && readiness.vector
    && runtimeConfiguration.agentProviderReady
    && embeddingIndex.ready;
  return { readiness, embeddingIndex, ready };
}

function healthResponse(snapshot: HealthSnapshot, cacheStatus: "HIT" | "MISS") {
  const { readiness, embeddingIndex, ready } = snapshot;
  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      service: "kampung-quest",
      database: { ready: readiness.database, adapter: runtimeConfiguration.store },
      pgvector: { ready: readiness.vector },
      embeddingIndex: {
        ready: embeddingIndex.ready,
        indexed: embeddingIndex.indexed,
        stale: embeddingIndex.stale,
      },
      agents: {
        ready: runtimeConfiguration.agentProviderReady,
        provider: runtimeConfiguration.agentProvider,
      },
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "cache-control": "public, max-age=5, stale-while-revalidate=25",
        "x-health-cache": cacheStatus,
      },
    },
  );
}
