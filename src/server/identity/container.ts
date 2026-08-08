import type { IdentityStore } from "@/server/identity/identity-store";
import { InMemoryIdentityStore } from "@/server/identity/identity-store";
import { PostgresIdentityStore } from "@/server/identity/postgres-identity-store";
import { assertProductionEnvironment, isProductionRuntime } from "@/server/runtime-environment";

const globals = globalThis as typeof globalThis & { identityStore?: IdentityStore };

function createIdentityStore(): IdentityStore {
  if (process.env.DATABASE_URL) return new PostgresIdentityStore(process.env.DATABASE_URL);
  if (isProductionRuntime()) throw new Error("DATABASE_URL is required in production");
  return new InMemoryIdentityStore();
}

assertProductionEnvironment();
export const identityStore = globals.identityStore ?? createIdentityStore();
if (process.env.NODE_ENV !== "production") globals.identityStore = identityStore;
