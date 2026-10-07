import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
import { createConfiguredEmbeddingProvider } from "@/server/agents/configured-embedding-provider";
import { resolveProviderConfiguration } from "@/server/agents/provider-configuration";
import { KampungQuestEngine } from "@/server/core/kampung-quest-engine";
import { PostgresIdentityStore } from "@/server/identity/postgres-identity-store";
import { PostgresKampungStore } from "@/server/repositories/postgres-kampung-store";
import { closeApplicationAiControl, withAiOperator } from "@/server/security/application-ai-control";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (process.env.REINDEX_CANDIDATES !== "YES") {
  throw new Error("Refusing to reindex candidates. Re-run with REINDEX_CANDIDATES=YES to confirm.");
}
const databaseHost = new URL(databaseUrl).hostname;
if (!["localhost", "127.0.0.1", "[::1]", "database"].includes(databaseHost)
  && process.env.ALLOW_REMOTE_REINDEX !== "YES") {
  throw new Error(`Refusing to reindex a remote database host: ${databaseHost}`);
}

const store = new PostgresKampungStore(databaseUrl);
const identities = new PostgresIdentityStore(databaseUrl);
const engine = new KampungQuestEngine({
  store,
  agents: new DeterministicAgentRuntime(),
  embeddings: createConfiguredEmbeddingProvider(resolveProviderConfiguration(process.env)),
  filterContactableCandidateIds: (candidateIds) => identities.filterContactableUserIds(candidateIds),
});

try {
  const before = await engine.getEmbeddingIndexStatus();
  const result = await withAiOperator("reindex", () => engine.reindexActiveMemories());
  const after = await engine.getEmbeddingIndexStatus();
  console.log(JSON.stringify({ before, result, after }, null, 2));
  if (result.failures.length > 0 || !after.ready) process.exitCode = 1;
} finally {
  await Promise.allSettled([store.pool.end(), identities.pool.end(), closeApplicationAiControl()]);
}
