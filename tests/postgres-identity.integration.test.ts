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
    const seededChats = await store!.listConversations(maria.id);
    expect(seededChats.some((conversation) => conversation.title === "Anne Lim")).toBe(false);
    expect(seededChats.some((conversation) => conversation.title === "Cooking Buddies")).toBe(false);

    const updated = await store!.updatePreferences(maria.id, {
      highContrast: true,
      textSize: "extra-large",
      accessibilityPreferences: { stairsAllowed: false, maximumDistanceM: 1000, language: "English" },
    });
    expect(updated.preferences).toMatchObject({ highContrast: true, textSize: "extra-large" });
    expect(updated.preferences.accessibilityPreferences).toEqual({ stairsAllowed: false, maximumDistanceM: 1000, language: "English" });
    const cleared = await store!.updatePreferences(maria.id, {
      accessibilityPreferences: { stairsAllowed: null, maximumDistanceM: null, language: null },
    });
    expect(cleared.preferences.accessibilityPreferences).toEqual({ stairsAllowed: null, maximumDistanceM: null, language: null });

    expect(await store!.isUsernameAvailable(`MARIA.${suffix}`)).toBe(false);
    expect((await store!.listContacts(lee.id, `maria.${suffix}`))[0]?.id).toBe(maria.id);

    const direct = await store!.createConversation(maria.id, { type: "direct", participantIds: [lee.id] });
    const reused = await store!.createConversation(lee.id, { type: "direct", participantIds: [maria.id] });
    expect(reused.id).toBe(direct.id);
    const sent = await store!.sendMessage(maria.id, direct.id, "Hello from PostgreSQL");
    expect(sent.receipt).toBe("delivered");
    expect((await store!.listMessages(lee.id, direct.id)).at(-1)?.body).toBe("Hello from PostgreSQL");
    expect((await store!.listMessages(maria.id, direct.id)).at(-1)?.receipt).toBe("read");

    const group = await store!.createConversation(maria.id, {
      type: "group",
      participantIds: [lee.id, "community_anne"],
      title: "Integration Friends",
    });
    expect(group).toMatchObject({ type: "group", memberCount: 3, title: "Integration Friends" });

    await store!.ensureQuestGroupConversation("quest-integration", "Quest Group", [maria.id]);
    await store!.ensureQuestGroupConversation("quest-integration", "Quest Group", [maria.id, lee.id]);
    const questGroup = (await store!.listConversations(lee.id)).find((conversation) => conversation.title === "Quest Group");
    expect(questGroup).toMatchObject({ type: "group", memberCount: 2 });

    const safetyDirect = await store!.createConversation(maria.id, { type: "direct", participantIds: [lee.id] });
    await store!.blockUser(maria.id, lee.id);
    expect((await store!.listContacts(maria.id, `lee.${suffix}`)).some((contact) => contact.id === lee.id)).toBe(false);
    expect((await store!.listConversations(maria.id)).find((conversation) => conversation.id === safetyDirect.id)?.blocked).toBe(true);
    await expect(store!.createConversation(maria.id, { type: "direct", participantIds: [lee.id] })).rejects.toThrow("blocked");
    await store!.unblockUser(maria.id, lee.id);
    await store!.deleteConversation(maria.id, safetyDirect.id);
    expect((await store!.listConversations(maria.id)).some((conversation) => conversation.id === safetyDirect.id)).toBe(false);
    const reopened = await store!.createConversation(maria.id, { type: "direct", participantIds: [lee.id] });
    expect(reopened.id).toBe(safetyDirect.id);
    await store!.leaveConversation(maria.id, group.id);
    expect((await store!.listConversations(maria.id)).some((conversation) => conversation.id === group.id)).toBe(false);
  });
});
