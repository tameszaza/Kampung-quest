import type { IdentityStore } from "@/server/identity/identity-store";
import { InMemoryIdentityStore } from "@/server/identity/identity-store";
import { PostgresIdentityStore } from "@/server/identity/postgres-identity-store";

const globals = globalThis as typeof globalThis & { identityStore?: IdentityStore };

function createIdentityStore(): IdentityStore {
  if (process.env.DATABASE_URL) return new PostgresIdentityStore(process.env.DATABASE_URL);
  return new InMemoryIdentityStore();
}

export const identityStore = globals.identityStore ?? createIdentityStore();
if (process.env.NODE_ENV !== "production") globals.identityStore = identityStore;

