import { describe, expect, it } from "vitest";
import { InMemoryIdentityStore } from "@/server/identity/identity-store";
import { createConversationSchema, registerSchema } from "@/server/identity/schemas";
import { defaultPreferences } from "@/server/identity/types";
import { normalizeUsername } from "@/server/identity/username";

function member(email: string, passwordHash = "scrypt$stored-only-for-test") {
  return {
    fullName: "Maria Santos",
    username: email.split("@")[0],
    email,
    phone: null,
    passwordHash,
    dateOfBirth: "1948-05-12",
    gender: "Female",
    preferredLanguage: "English",
    area: "Tampines",
    photoUrl: null,
    preferences: structuredClone(defaultPreferences),
  };
}

describe("member identity security", () => {
  it("validates account and conversation contracts", () => {
    const input = registerSchema.parse({
      fullName: "Maria Santos",
      username: "Maria Santos",
      email: "maria@example.com",
      password: "Friendly123",
      preferredLanguage: "English",
    });
    expect(input.groupSize).toBe("small");
    expect(() => registerSchema.parse({ fullName: "Maria", password: "Friendly123" })).toThrow();
    expect(() => createConversationSchema.parse({ type: "direct", participantIds: ["a", "b"] })).toThrow();
  });

  it("normalizes searchable display names consistently", () => {
    expect(normalizeUsername("  María Santos  ")).toBe("maria.santos");
    expect(normalizeUsername("David_Lee")).toBe("david_lee");
    expect(normalizeUsername("王 阿姨")).toBe("王.阿姨");
  });
});

describe("member preferences and chat", () => {
  it("creates per-user preferences and rejects duplicate identities", async () => {
    const store = new InMemoryIdentityStore();
    const user = await store.createUser(member("maria@example.com"));
    expect(user.preferences.textSize).toBe("large");
    await expect(store.createUser(member("MARIA@example.com"))).rejects.toThrow("already exists");
    await expect(store.createUser({ ...member("another@example.com"), username: "MARIA" })).rejects.toThrow("display name");

    const updated = await store.updatePreferences(user.id, {
      textSize: "extra-large",
      highContrast: true,
      interests: ["Cooking"],
    });
    expect(updated.preferences).toMatchObject({ textSize: "extra-large", highContrast: true, interests: ["Cooking"] });
    const matches = await store.listContacts(user.id, "anne");
    expect(matches.some((contact) => contact.username === "anne.lim")).toBe(true);
  });

  it("supports welcome chats, direct-message reuse, groups, and stored messages", async () => {
    const store = new InMemoryIdentityStore();
    const maria = await store.createUser(member("maria@example.com"));
    const lee = await store.createUser({ ...member("lee@example.com"), fullName: "Lee Ming" });
    const welcomeChats = await store.listConversations(maria.id);
    expect(welcomeChats.some((chat) => chat.title === "Anne Lim")).toBe(false);
    expect(welcomeChats.some((chat) => chat.title === "Cooking Buddies")).toBe(false);

    const direct = await store.createConversation(maria.id, { type: "direct", participantIds: [lee.id] });
    const duplicate = await store.createConversation(lee.id, { type: "direct", participantIds: [maria.id] });
    expect(duplicate.id).toBe(direct.id);

    const group = await store.createConversation(maria.id, {
      type: "group",
      participantIds: [lee.id, "community_anne"],
      title: "Garden Friends",
    });
    expect(group.memberCount).toBe(3);
    const sent = await store.sendMessage(maria.id, group.id, "Shall we meet on Friday?");
    expect(sent.receipt).toBe("delivered");
    const history = await store.listMessages(lee.id, group.id);
    expect(history.at(-1)).toMatchObject({ body: "Shall we meet on Friday?", mine: false });
    await store.listMessages("community_anne", group.id);
    expect((await store.listMessages(maria.id, group.id)).at(-1)?.receipt).toBe("read");
  });

  it("updates account details and only exposes chat profile details to conversation members", async () => {
    const store = new InMemoryIdentityStore();
    const maria = await store.createUser(member("maria-profile@example.com"));
    const lee = await store.createUser({ ...member("lee-profile@example.com"), fullName: "Lee Profile" });
    const outsider = await store.createUser({ ...member("outsider-profile@example.com"), fullName: "Other Profile" });
    const updated = await store.updateProfile(lee.id, {
      fullName: "Lee Updated",
      phone: "+6561234567",
      emergencyContact: { name: "Sam Lee", relationship: "Sibling", phone: "+6567654321", email: "sam@example.com" },
    });
    expect(updated).toMatchObject({ fullName: "Lee Updated", phone: "+6561234567" });
    const direct = await store.createConversation(maria.id, { type: "direct", participantIds: [lee.id] });
    await expect(store.getChatProfile(outsider.id, lee.id, direct.id)).rejects.toThrow("not found");
    await expect(store.getChatProfile(maria.id, lee.id, direct.id)).resolves.toMatchObject({
      fullName: "Lee Updated",
      emergencyContact: { name: "Sam Lee", phone: "+6567654321" },
    });
  });

  it("shows demo welcome chats only for the exact test display name", async () => {
    const store = new InMemoryIdentityStore();
    const testUser = await store.createUser({ ...member("chat-test@example.com"), fullName: "Test", username: "test" });
    const normalUser = await store.createUser({ ...member("chat-member@example.com"), fullName: "Chat Member", username: "chat.member" });
    const testChats = await store.listConversations(testUser.id);
    const normalChats = await store.listConversations(normalUser.id);
    expect(testChats.some((chat) => chat.title === "Anne Lim")).toBe(true);
    expect(testChats.some((chat) => chat.title === "Cooking Buddies")).toBe(true);
    expect(normalChats.some((chat) => chat.title === "Anne Lim")).toBe(false);
    expect(normalChats.some((chat) => chat.title === "Cooking Buddies")).toBe(false);
  });

  it("creates one quest group and adds each accepted member once", async () => {
    const store = new InMemoryIdentityStore();
    const first = await store.createUser({ ...member("quest-first@example.com"), fullName: "Quest First", username: "quest.first" });
    const second = await store.createUser({ ...member("quest-second@example.com"), fullName: "Quest Second", username: "quest.second" });
    await store.ensureQuestGroupConversation("quest_123", "Garden Friends", [first.id]);
    await store.ensureQuestGroupConversation("quest_123", "Garden Friends", [first.id, second.id]);
    const firstGroup = (await store.listConversations(first.id)).find((chat) => chat.title === "Garden Friends");
    const secondGroup = (await store.listConversations(second.id)).find((chat) => chat.title === "Garden Friends");
    expect(firstGroup).toMatchObject({ type: "group", memberCount: 2 });
    expect(secondGroup?.id).toBe(firstGroup?.id);
    await store.ensureQuestGroupConversation("quest_123", "Garden Friends", [second.id]);
    expect((await store.listConversations(first.id)).filter((chat) => chat.title === "Garden Friends")).toHaveLength(1);
  });

  it("honors privacy choices when discovering people and starting chats", async () => {
    const store = new InMemoryIdentityStore();
    const maria = await store.createUser(member("maria-privacy@example.com"));
    const lee = await store.createUser({ ...member("lee-privacy@example.com"), fullName: "Lee Privacy" });

    await store.updatePreferences(lee.id, { profileVisibility: "private", messagePrivacy: "nobody" });
    expect((await store.listContacts(maria.id, "lee privacy")).some((contact) => contact.id === lee.id)).toBe(false);
    await expect(store.createConversation(maria.id, { type: "direct", participantIds: [lee.id] })).rejects.toThrow("not accepting");

    await store.updatePreferences(lee.id, { profileVisibility: "community", messagePrivacy: "nobody" });
    expect((await store.listContacts(maria.id, "lee privacy")).some((contact) => contact.id === lee.id)).toBe(true);
    await expect(store.createConversation(maria.id, { type: "direct", participantIds: [lee.id] })).rejects.toThrow("not accepting");

    await store.updatePreferences(lee.id, { messagePrivacy: "connections" });
    await expect(store.createConversation(maria.id, { type: "direct", participantIds: [lee.id] })).rejects.toThrow("not accepting");
    await store.createConversation(maria.id, { type: "group", participantIds: [lee.id], title: "Privacy Friends" });
    const direct = await store.createConversation(maria.id, { type: "direct", participantIds: [lee.id] });
    expect(direct.type).toBe("direct");
  });

  it("does not expose conversations to non-members", async () => {
    const store = new InMemoryIdentityStore();
    const maria = await store.createUser(member("maria@example.com"));
    const lee = await store.createUser({ ...member("lee@example.com"), fullName: "Lee Ming" });
    const outsider = await store.createUser({ ...member("outsider@example.com"), fullName: "Other Person" });
    const direct = await store.createConversation(maria.id, { type: "direct", participantIds: [lee.id] });
    await expect(store.listMessages(outsider.id, direct.id)).rejects.toThrow("not found");
    await expect(store.sendMessage(outsider.id, direct.id, "Hello")).rejects.toThrow("not found");
  });

  it("supports leaving groups and blocking direct contacts", async () => {
    const store = new InMemoryIdentityStore();
    const maria = await store.createUser(member("maria-safety@example.com"));
    const lee = await store.createUser({ ...member("lee-safety@example.com"), fullName: "Lee Safety" });
    const group = await store.createConversation(maria.id, {
      type: "group",
      participantIds: [lee.id],
      title: "Safety Friends",
    });
    const direct = await store.createConversation(maria.id, { type: "direct", participantIds: [lee.id] });
    await store.sendMessage(lee.id, group.id, "A group update");
    await store.sendMessage(lee.id, direct.id, "Before the block");

    await store.blockUser(maria.id, lee.id);
    expect((await store.listBlockedUsers(maria.id))[0]?.id).toBe(lee.id);
    expect((await store.listContacts(maria.id, "lee")).some((contact) => contact.id === lee.id)).toBe(false);
    expect((await store.listMessages(maria.id, group.id)).some((message) => message.body === "A group update")).toBe(true);
    expect((await store.listMessages(maria.id, direct.id)).some((message) => message.body === "Before the block")).toBe(true);
    expect((await store.listConversations(maria.id)).find((conversation) => conversation.id === direct.id)?.blocked).toBe(true);
    await expect(store.createConversation(maria.id, { type: "direct", participantIds: [lee.id] })).rejects.toThrow("blocked");

    await store.unblockUser(maria.id, lee.id);
    expect((await store.listBlockedUsers(maria.id)).length).toBe(0);
    expect((await store.listContacts(maria.id, "lee")).some((contact) => contact.id === lee.id)).toBe(true);

    await store.deleteConversation(maria.id, direct.id);
    expect((await store.listConversations(maria.id)).some((conversation) => conversation.id === direct.id)).toBe(false);
    const reopened = await store.createConversation(maria.id, { type: "direct", participantIds: [lee.id] });
    expect(reopened.id).toBe(direct.id);

    await store.leaveConversation(maria.id, group.id);
    expect((await store.listConversations(maria.id)).some((conversation) => conversation.id === group.id)).toBe(false);
    expect((await store.listConversations(lee.id)).some((conversation) => conversation.id === group.id)).toBe(true);
    await expect(store.leaveConversation(maria.id, direct.id)).rejects.toThrow("cannot be left");
  });
});
