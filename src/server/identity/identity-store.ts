import { randomUUID } from "node:crypto";
import type {
  ChatContact,
  ChatMessage,
  ConversationSummary,
  StoredUser,
  UserPreferences,
  UserProfile,
} from "@/server/identity/types";
import { defaultPreferences, publicUser } from "@/server/identity/types";

export type NewUser = Omit<StoredUser, "id" | "accountType">;

export interface IdentityStore {
  createUser(input: NewUser): Promise<UserProfile>;
  findUserByIdentifier(identifier: string): Promise<StoredUser | null>;
  findUserById(userId: string): Promise<StoredUser | null>;
  updatePreferences(userId: string, input: Partial<UserPreferences> & { preferredLanguage?: string; area?: string | null }): Promise<UserProfile>;
  createSession(sessionHash: string, userId: string, expiresAt: Date): Promise<void>;
  findUserBySession(sessionHash: string): Promise<UserProfile | null>;
  deleteSession(sessionHash: string): Promise<void>;
  listContacts(userId: string): Promise<ChatContact[]>;
  listConversations(userId: string): Promise<ConversationSummary[]>;
  createConversation(userId: string, input: { type: "direct" | "group"; participantIds: string[]; title?: string }): Promise<ConversationSummary>;
  listMessages(userId: string, conversationId: string): Promise<ChatMessage[]>;
  sendMessage(userId: string, conversationId: string, body: string): Promise<ChatMessage>;
}

type MemoryConversation = {
  id: string;
  type: "direct" | "group";
  title: string | null;
  imageUrl: string | null;
  memberIds: string[];
  directKey: string | null;
  updatedAt: string;
};

type MemoryMessage = {
  id: string;
  conversationId: string;
  senderId: string | null;
  body: string;
  createdAt: string;
};

const communityMembers: StoredUser[] = [
  communityUser("community_anne", "Anne Lim", "/assets/profile-anne.jpg"),
  communityUser("community_david", "David Lee", "/assets/profile-david.jpg"),
  communityUser("community_john", "John Tan", "/assets/profile-john.jpg"),
];

function communityUser(id: string, fullName: string, photoUrl: string): StoredUser {
  return {
    id,
    fullName,
    email: `${id}@community.seniorquest.local`,
    phone: null,
    passwordHash: null,
    dateOfBirth: null,
    gender: null,
    preferredLanguage: "English",
    area: "Nearby",
    photoUrl,
    accountType: "community",
    preferences: structuredClone(defaultPreferences),
  };
}

export class InMemoryIdentityStore implements IdentityStore {
  private readonly users = new Map<string, StoredUser>(communityMembers.map((user) => [user.id, user]));
  private readonly sessions = new Map<string, { userId: string; expiresAt: Date }>();
  private readonly conversations = new Map<string, MemoryConversation>();
  private readonly messages = new Map<string, MemoryMessage[]>();

  async createUser(input: NewUser): Promise<UserProfile> {
    const email = input.email?.toLowerCase() ?? null;
    const phone = normalizePhone(input.phone);
    if ([...this.users.values()].some((user) => email && user.email?.toLowerCase() === email)) {
      throw new Error("An account already exists for that email");
    }
    if ([...this.users.values()].some((user) => phone && normalizePhone(user.phone) === phone)) {
      throw new Error("An account already exists for that phone number");
    }
    const user: StoredUser = {
      ...input,
      id: randomUUID(),
      email,
      phone,
      accountType: "member",
      preferences: { ...defaultPreferences, ...input.preferences },
    };
    this.users.set(user.id, user);
    this.seedWelcomeChats(user.id);
    return publicUser(user);
  }

  async findUserByIdentifier(identifier: string): Promise<StoredUser | null> {
    const normalizedEmail = identifier.trim().toLowerCase();
    const normalizedPhone = normalizePhone(identifier);
    return [...this.users.values()].find((user) =>
      user.accountType === "member" && (
        user.email?.toLowerCase() === normalizedEmail ||
        (normalizedPhone && normalizePhone(user.phone) === normalizedPhone)
      )) ?? null;
  }

  async findUserById(userId: string): Promise<StoredUser | null> {
    return this.users.get(userId) ?? null;
  }

  async updatePreferences(userId: string, input: Partial<UserPreferences> & { preferredLanguage?: string; area?: string | null }): Promise<UserProfile> {
    const user = this.requireUser(userId);
    const { preferredLanguage, area, ...preferences } = input;
    const next = {
      ...user,
      preferredLanguage: preferredLanguage ?? user.preferredLanguage,
      area: area === undefined ? user.area : area,
      preferences: { ...user.preferences, ...preferences },
    };
    this.users.set(userId, next);
    return publicUser(next);
  }

  async createSession(sessionHash: string, userId: string, expiresAt: Date): Promise<void> {
    this.requireUser(userId);
    this.sessions.set(sessionHash, { userId, expiresAt });
  }

  async findUserBySession(sessionHash: string): Promise<UserProfile | null> {
    const session = this.sessions.get(sessionHash);
    if (!session || session.expiresAt <= new Date()) {
      if (session) this.sessions.delete(sessionHash);
      return null;
    }
    const user = this.users.get(session.userId);
    return user ? publicUser(user) : null;
  }

  async deleteSession(sessionHash: string): Promise<void> {
    this.sessions.delete(sessionHash);
  }

  async listContacts(userId: string): Promise<ChatContact[]> {
    this.requireUser(userId);
    return [...this.users.values()]
      .filter((user) => user.id !== userId)
      .map((user) => ({ id: user.id, fullName: user.fullName, photoUrl: user.photoUrl }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    this.requireUser(userId);
    return [...this.conversations.values()]
      .filter((conversation) => conversation.memberIds.includes(userId))
      .map((conversation) => this.toSummary(userId, conversation))
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }

  async createConversation(userId: string, input: { type: "direct" | "group"; participantIds: string[]; title?: string }): Promise<ConversationSummary> {
    this.requireUser(userId);
    const participantIds = [...new Set(input.participantIds.filter((id) => id !== userId))];
    participantIds.forEach((id) => this.requireUser(id));
    const memberIds = [userId, ...participantIds];
    const directKey = input.type === "direct" ? [...memberIds].sort().join(":") : null;
    const existing = directKey
      ? [...this.conversations.values()].find((conversation) => conversation.directKey === directKey)
      : undefined;
    if (existing) return this.toSummary(userId, existing);
    const now = new Date().toISOString();
    const conversation: MemoryConversation = {
      id: randomUUID(),
      type: input.type,
      title: input.title ?? null,
      imageUrl: input.type === "group" ? "/assets/profile-group.jpg" : null,
      memberIds,
      directKey,
      updatedAt: now,
    };
    this.conversations.set(conversation.id, conversation);
    this.messages.set(conversation.id, []);
    return this.toSummary(userId, conversation);
  }

  async listMessages(userId: string, conversationId: string): Promise<ChatMessage[]> {
    const conversation = this.requireConversationMember(userId, conversationId);
    return (this.messages.get(conversation.id) ?? []).map((message) => this.toMessage(userId, message));
  }

  async sendMessage(userId: string, conversationId: string, body: string): Promise<ChatMessage> {
    const conversation = this.requireConversationMember(userId, conversationId);
    const message: MemoryMessage = {
      id: randomUUID(),
      conversationId,
      senderId: userId,
      body,
      createdAt: new Date().toISOString(),
    };
    this.messages.set(conversationId, [...(this.messages.get(conversationId) ?? []), message]);
    conversation.updatedAt = message.createdAt;
    return this.toMessage(userId, message);
  }

  private seedWelcomeChats(userId: string) {
    const direct = this.createMemoryConversation("direct", [userId, "community_anne"], null);
    this.messages.set(direct.id, [
      this.seedMessage(direct.id, "community_anne", "Hi! I’m Anne. Welcome to Senior Quest — message me if you need help getting started. 😊", -8),
    ]);
    const group = this.createMemoryConversation("group", [userId, "community_anne", "community_david"], "Cooking Buddies");
    group.imageUrl = "/assets/profile-group.jpg";
    this.messages.set(group.id, [
      this.seedMessage(group.id, "community_anne", "Welcome to Cooking Buddies! We share simple recipes and plan friendly lunches here.", -5),
      this.seedMessage(group.id, "community_david", "Glad you’re here! 👋", -4),
    ]);
  }

  private createMemoryConversation(type: "direct" | "group", memberIds: string[], title: string | null) {
    const directKey = type === "direct" ? [...memberIds].sort().join(":") : null;
    const conversation: MemoryConversation = {
      id: randomUUID(), type, title, imageUrl: null, memberIds, directKey, updatedAt: new Date().toISOString(),
    };
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  private seedMessage(conversationId: string, senderId: string, body: string, minutes: number): MemoryMessage {
    return { id: randomUUID(), conversationId, senderId, body, createdAt: new Date(Date.now() + minutes * 60_000).toISOString() };
  }

  private toSummary(userId: string, conversation: MemoryConversation): ConversationSummary {
    const messages = this.messages.get(conversation.id) ?? [];
    const last = messages.at(-1);
    const other = this.users.get(conversation.memberIds.find((id) => id !== userId) ?? "");
    return {
      id: conversation.id,
      type: conversation.type,
      title: conversation.type === "direct" ? other?.fullName ?? "Conversation" : conversation.title ?? "Group",
      imageUrl: conversation.type === "direct" ? other?.photoUrl ?? null : conversation.imageUrl,
      preview: last?.body ?? "Start the conversation",
      lastMessageAt: last?.createdAt ?? conversation.updatedAt,
      unreadCount: last?.senderId && last.senderId !== userId ? 1 : 0,
      memberCount: conversation.memberIds.length,
    };
  }

  private toMessage(userId: string, message: MemoryMessage): ChatMessage {
    const sender = message.senderId ? this.users.get(message.senderId) : null;
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderName: sender?.fullName ?? "Senior Quest",
      senderImageUrl: sender?.photoUrl ?? null,
      body: message.body,
      createdAt: message.createdAt,
      mine: message.senderId === userId,
    };
  }

  private requireUser(userId: string) {
    const user = this.users.get(userId);
    if (!user) throw new Error("User not found");
    return user;
  }

  private requireConversationMember(userId: string, conversationId: string) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || !conversation.memberIds.includes(userId)) throw new Error("Conversation not found");
    return conversation;
  }
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const plus = phone.trim().startsWith("+") ? "+" : "";
  return `${plus}${phone.replace(/\D/g, "")}`;
}

export const seededCommunityMembers = communityMembers;
