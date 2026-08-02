import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { auth, betterAuthPool } from "@/lib/auth";

const enabled = Boolean(process.env.DATABASE_URL);
const createdIds: string[] = [];

describe.skipIf(!enabled)("Better Auth credentials", () => {
  afterAll(async () => {
    if (createdIds.length) await betterAuthPool.query('DELETE FROM auth."user" WHERE "id" = ANY($1::text[])', [createdIds]);
  });

  it("stores a non-plaintext password and enforces unique searchable usernames", async () => {
    const suffix = randomUUID().slice(0, 8);
    const email = `better-auth.${suffix}@example.com`;
    const password = "Friendly123";
    const username = `Friendly ${suffix}`;
    const result = await auth.api.signUpEmail({ body: { name: "Friendly Tester", email, password, username, displayUsername: username } });
    createdIds.push(result.user.id);

    const account = await betterAuthPool.query<{ password: string | null }>(
      'SELECT "password" FROM auth."account" WHERE "userId" = $1 AND "providerId" = $2',
      [result.user.id, "credential"],
    );
    expect(account.rows[0]?.password).toBeTruthy();
    expect(account.rows[0]?.password).not.toBe(password);
    expect(account.rows[0]?.password).not.toContain(password);

    const signedIn = await auth.api.signInUsername({ body: { username, password } });
    expect(signedIn.user.id).toBe(result.user.id);

    await expect(auth.api.signUpEmail({ body: {
      name: "Duplicate Name", email: `duplicate.${suffix}@example.com`, password,
      username: username.toUpperCase(), displayUsername: username.toUpperCase(),
    } })).rejects.toThrow();
  });
});
