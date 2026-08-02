import { NextResponse } from "next/server";
import { kampungStore, runtimeConfiguration } from "@/server/container";

export async function GET() {
  const readiness = await kampungStore.healthCheck();
  const ready = readiness.database && readiness.vector && runtimeConfiguration.agentProviderReady;
  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      service: "kampung-quest",
      database: { ready: readiness.database, adapter: runtimeConfiguration.store },
      pgvector: { ready: readiness.vector },
      agents: {
        ready: runtimeConfiguration.agentProviderReady,
        provider: runtimeConfiguration.agentProvider,
      },
    },
    { status: ready ? 200 : 503 },
  );
}
