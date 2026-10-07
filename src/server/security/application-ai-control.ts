import { AsyncLocalStorage } from "node:async_hooks";
import { createAiControlledFetch } from "@/server/security/ai-provider-fetch";
import { readAiPolicy } from "@/server/security/ai-policy";
import { InMemoryAiUsageStore, PostgresAiUsageStore, type AiUsageStore } from "@/server/security/ai-usage-store";
import { isProductionRuntime } from "@/server/runtime-environment";

const operatorContext = new AsyncLocalStorage<string>();
const globals = globalThis as typeof globalThis & { aiUsageStore?: AiUsageStore };

/** Server-only attribution for scripts; operator work also consumes global budgets. */
export function withAiOperator<T>(operation: "reindex" | "seed-test-users", run: () => T): T {
  return operatorContext.run(`operator:${operation}`, run);
}

export async function closeApplicationAiControl(): Promise<void> {
  if (globals.aiUsageStore instanceof PostgresAiUsageStore) await globals.aiUsageStore.pool.end();
  delete globals.aiUsageStore;
}

export function createApplicationAiFetch(models: readonly string[], baseFetch: typeof fetch = fetch): typeof fetch {
  const policy = readAiPolicy();
  let store = globals.aiUsageStore;
  if (isProductionRuntime() && store instanceof InMemoryAiUsageStore) {
    throw new Error("AI admission control requires PostgreSQL in production");
  }
  if (!store) {
    if (process.env.DATABASE_URL) store = new PostgresAiUsageStore(process.env.DATABASE_URL);
    else if (isProductionRuntime()) throw new Error("DATABASE_URL is required for AI admission control");
    else store = new InMemoryAiUsageStore();
    globals.aiUsageStore = store;
  }
  return createAiControlledFetch({
    store, policy, models, fetch: baseFetch,
    resolveActor: async () => {
      const operator = operatorContext.getStore();
      if (operator) return operator;
      // Derive attribution from the server session, never from the AI payload.
      const [{ headers }, { auth }] = await Promise.all([import("next/headers"), import("@/lib/auth")]);
      const session = await auth.api.getSession({ headers: await headers() });
      return session?.user.id ?? null;
    },
  });
}
