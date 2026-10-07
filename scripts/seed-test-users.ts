import { isDeepStrictEqual } from "node:util";
import { auth, betterAuthPool } from "@/lib/auth";
import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
import { createConfiguredEmbeddingProvider } from "@/server/agents/configured-embedding-provider";
import { resolveProviderConfiguration } from "@/server/agents/provider-configuration";
import { KampungQuestEngine } from "@/server/core/kampung-quest-engine";
import { PostgresIdentityStore } from "@/server/identity/postgres-identity-store";
import { PostgresKampungStore } from "@/server/repositories/postgres-kampung-store";
import { closeApplicationAiControl, withAiOperator } from "@/server/security/application-ai-control";
import {
  createTestCandidateProfile,
  createTestPersonaNarrative,
  refreshTestCandidateAvailability,
  TEST_USER_PASSWORD,
  TEST_USER_PERSONAS,
} from "@/server/testing/test-user-personas";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to seed test users");

assertSafeTarget(databaseUrl);

const identityStore = new PostgresIdentityStore(databaseUrl);
const kampungStore = new PostgresKampungStore(databaseUrl);
const engine = new KampungQuestEngine({
  store: kampungStore,
  agents: new DeterministicAgentRuntime(),
  embeddings: createConfiguredEmbeddingProvider(resolveProviderConfiguration(process.env)),
});
const result = {
  createdAccounts: 0,
  reusedAccounts: 0,
  updatedMemories: 0,
  reusedMemories: 0,
  users: [] as Array<{ fixtureKey: string; userId: string; username: string; email: string }>,
};
const authUsers = new Map<string, { id: string; email: string; username: string }>();

try {
  const health = await kampungStore.healthCheck();
  if (!health.database || !health.vector) {
    throw new Error("The database or pgvector extension is unavailable. Run npm run db:migrate first.");
  }

  for (const persona of TEST_USER_PERSONAS) {
    const existing = await betterAuthPool.query<{ id: string; email: string; username: string | null }>(
      `SELECT "id", "email", "username" FROM auth."user"
       WHERE lower("email") = lower($1) OR lower("username") = lower($2)`,
      [persona.email, persona.username],
    );
    if (existing.rowCount && existing.rowCount > 1) {
      throw new Error(`Fixture ${persona.fixtureKey} conflicts with more than one existing auth user.`);
    }

    const authUser = existing.rows[0];
    if (authUser) {
      if (authUser.email.toLowerCase() !== persona.email || authUser.username?.toLowerCase() !== persona.username) {
        throw new Error(`Fixture ${persona.fixtureKey} conflicts with an existing email or username.`);
      }
      authUsers.set(persona.fixtureKey, { id: authUser.id, email: authUser.email, username: persona.username });
      await verifyLogin(persona.username);
      result.reusedAccounts += 1;
    }
  }

  for (const persona of TEST_USER_PERSONAS) {
    if (!authUsers.has(persona.fixtureKey)) {
      const signUp = await auth.api.signUpEmail({
        body: {
          name: persona.fullName,
          email: persona.email,
          password: TEST_USER_PASSWORD,
          username: persona.username,
          displayUsername: persona.username,
        },
      });
      authUsers.set(persona.fixtureKey, {
        id: signUp.user.id,
        email: signUp.user.email,
        username: signUp.user.username ?? persona.username,
      });
      await verifyLogin(persona.username);
      result.createdAccounts += 1;
    }
  }

  for (const persona of TEST_USER_PERSONAS) {
    const authUser = authUsers.get(persona.fixtureKey)!;
    await identityStore.ensureAuthUser({
      id: authUser.id,
      fullName: persona.fullName,
      email: persona.email,
      photoUrl: null,
      username: persona.username,
    });
    await identityStore.completeProfile(authUser.id, {
      fullName: persona.fullName,
      username: persona.username,
      phone: null,
      dateOfBirth: persona.dateOfBirth,
      gender: persona.gender,
      preferredLanguage: persona.languages[0],
      area: persona.area,
      photoUrl: null,
      preferences: {
        interests: [...persona.interests],
        groupSize: persona.maximumGroupSize === 2 ? "one-to-one" : persona.maximumGroupSize <= 4 ? "small" : "any",
        activityLevel: persona.activityLevel,
        accessibilityPreferences: {
          stairsAllowed: persona.stairsAllowed,
          maximumDistanceM: persona.maximumDistanceM,
          language: persona.languages[0] ?? null,
        },
      },
    });
    await identityStore.updatePreferences(authUser.id, { accessibilityNeeds: [...persona.accessibilityNeeds] });

    const current = await kampungStore.findMemory(authUser.id);
    const profile = current
      ? refreshTestCandidateAvailability(persona, current.profile)
      : createTestCandidateProfile(persona, authUser.id);
    const narrative = current?.narrative ?? createTestPersonaNarrative(persona);
    if (current && current.narrative === narrative && isDeepStrictEqual(current.profile, profile)) {
      result.reusedMemories += 1;
    } else {
      await withAiOperator("seed-test-users", () => engine.recordMemory({
        profile,
        narrative,
        providedSoftFacts: { need: true, interests: true, offers: true },
      }));
      result.updatedMemories += 1;
    }
    result.users.push({ fixtureKey: persona.fixtureKey, userId: authUser.id, username: persona.username, email: persona.email });
  }

  console.log(JSON.stringify(result, null, 2));
} finally {
  const fixtureUserIds = [...authUsers.values()].map((user) => user.id);
  if (fixtureUserIds.length) {
    await betterAuthPool.query('DELETE FROM auth."session" WHERE "userId" = ANY($1::text[])', [fixtureUserIds]);
  }
  await Promise.allSettled([identityStore.pool.end(), kampungStore.pool.end(), betterAuthPool.end(), closeApplicationAiControl()]);
}

async function verifyLogin(username: string): Promise<void> {
  try {
    const signedIn = await auth.api.signInUsername({ body: { username, password: TEST_USER_PASSWORD } });
    if (signedIn.user.username !== username) throw new Error("The returned username did not match");
  } catch (error) {
    throw new Error(
      `Fixture ${username} exists but does not accept the password in test-data/test-users.csv. No persona data was updated.`,
      { cause: error },
    );
  }
}

function assertSafeTarget(connectionString: string): void {
  if (process.env.SEED_TEST_USERS !== "YES") {
    throw new Error("Refusing to seed test accounts. Re-run with SEED_TEST_USERS=YES to confirm.");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed test accounts when NODE_ENV=production.");
  }
  const url = new URL(connectionString);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error(`Refusing to seed a non-local database host: ${url.hostname}`);
  }
}
