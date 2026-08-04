import { NextResponse } from "next/server";
import { kampungQuestEngine, kampungStore, runtimeConfiguration } from "@/server/container";

export async function GET() {
  const [readiness, embeddingIndex] = await Promise.all([
    kampungStore.healthCheck(),
    kampungQuestEngine.getEmbeddingIndexStatus(),
  ]);
  const ready = readiness.database
    && readiness.vector
    && runtimeConfiguration.agentProviderReady
    && embeddingIndex.ready;
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
    { status: ready ? 200 : 503 },
  );
}
