import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PostgresIdentityStore } from "@/server/identity/postgres-identity-store";
import { defaultPreferences } from "@/server/identity/types";

const databaseUrl = process.env.DATABASE_URL;
const store = databaseUrl ? new PostgresIdentityStore(databaseUrl) : null;
const createdIds: string[] = [];

describe.skipIf(!store)("PostgreSQL member identity and chat", () => {
  afterAll(async () => {
    if (!store) return;
    if (createdIds.length) {
      await store.pool.query("DELETE FROM identity.users WHERE user_id = ANY($1::text[])", [createdIds]);
    }
    await store.pool.end();
  });

  it("persists member settings, unique names, direct chat, and group messages", async () => {
    const suffix = randomUUID().slice(0, 8);
    const passwordHash = "legacy-column-unused-by-better-auth";
    const maria = await store!.createUser({
      fullName: "Maria Integration",
      username: `maria.${suffix}`,
      email: `maria.${suffix}@example.com`,
      phone: null,
      passwordHash,
      dateOfBirth: "1950-05-12",
      gender: "Female",
      preferredLanguage: "English",
      area: "Tampines",
      photoUrl: null,
      preferences: structuredClone(defaultPreferences),
    });
    const lee = await store!.createUser({
      fullName: "Lee Integration",
      username: `lee.${suffix}`,
      email: `lee.${suffix}@example.com`,
      phone: null,
      passwordHash,
      dateOfBirth: null,
      gender: null,
      preferredLanguage: "English",
      area: "Tampines",
      photoUrl: null,
      preferences: structuredClone(defaultPreferences),
    });
    createdIds.push(maria.id, lee.id);
    expect(maria.dateOfBirth).toBe("1950-05-12");

    const updated = await store!.updatePreferences(maria.id, { highContrast: true, textSize: "extra-large" });
    expect(updated.preferences).toMatchObject({ highContrast: true, textSize: "extra-large" });

    expect(await store!.isUsernameAvailable(`MARIA.${suffix}`)).toBe(false);
    expect((await store!.listContacts(lee.id, `maria.${suffix}`))[0]?.id).toBe(maria.id);

    const direct = await store!.createConversation(maria.id, { type: "direct", participantIds: [lee.id] });
    const reused = await store!.createConversation(lee.id, { type: "direct", participantIds: [maria.id] });
    expect(reused.id).toBe(direct.id);
    await store!.sendMessage(maria.id, direct.id, "Hello from PostgreSQL");
    expect((await store!.listMessages(lee.id, direct.id)).at(-1)?.body).toBe("Hello from PostgreSQL");

    const group = await store!.createConversation(maria.id, {
      type: "group",
      participantIds: [lee.id, "community_anne"],
      title: "Integration Friends",
    });
    expect(group).toMatchObject({ type: "group", memberCount: 3, title: "Integration Friends" });
  });
});
