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
import { normalizeUsername } from "@/server/identity/username";

export type NewUser = Omit<StoredUser, "id" | "accountType" | "username" | "onboardingComplete"> & {
  username?: string | null;
  onboardingComplete?: boolean;
};

export type AuthIdentityInput = {
  id: string;
  fullName: string;
  email: string;
  photoUrl: string | null;
  username?: string | null;
};

export type CompleteProfileInput = {
  fullName: string;
  username: string;
  phone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  preferredLanguage: string;
  area: string | null;
  photoUrl: string | null;
  preferences: Pick<UserPreferences, "interests" | "groupSize" | "activityLevel">;
};

export interface IdentityStore {
  createUser(input: NewUser): Promise<UserProfile>;
  ensureAuthUser(input: AuthIdentityInput): Promise<UserProfile>;
  completeProfile(userId: string, input: CompleteProfileInput): Promise<UserProfile>;
  updatePhoto(userId: string, photoUrl: string | null): Promise<UserProfile>;
  isUsernameAvailable(username: string, excludeUserId?: string): Promise<boolean>;
  findUserById(userId: string): Promise<StoredUser | null>;
  updatePreferences(userId: string, input: Partial<UserPreferences> & { preferredLanguage?: string; area?: string | null }): Promise<UserProfile>;
  listContacts(userId: string, query?: string): Promise<ChatContact[]>;
  listBlockedUsers(userId: string): Promise<ChatContact[]>;
  listConversations(userId: string): Promise<ConversationSummary[]>;
  createConversation(userId: string, input: { type: "direct" | "group"; participantIds: string[]; title?: string; systemInitiated?: boolean }): Promise<ConversationSummary>;
  deleteConversation(userId: string, conversationId: string): Promise<void>;
  leaveConversation(userId: string, conversationId: string): Promise<void>;
  blockUser(userId: string, blockedUserId: string): Promise<void>;
  unblockUser(userId: string, blockedUserId: string): Promise<void>;
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
    username: normalizeUsername(fullName),
    email: `${id}@community.seniorquest.local`,
    phone: null,
    passwordHash: null,
    dateOfBirth: null,
    gender: null,
    preferredLanguage: "English",
    area: "Nearby",
    photoUrl,
    onboardingComplete: true,
    accountType: "community",
    preferences: structuredClone(defaultPreferences),
  };
}

export class InMemoryIdentityStore implements IdentityStore {
  private readonly users = new Map<string, StoredUser>(communityMembers.map((user) => [user.id, user]));
  private readonly conversations = new Map<string, MemoryConversation>();
  private readonly messages = new Map<string, MemoryMessage[]>();
  /** Last time each member opened a conversation, used to derive read receipts. */
  private readonly lastReadAt = new Map<string, string>();
  private readonly blockedPairs = new Set<string>();
  private readonly deletedConversations = new Set<string>();

  async createUser(input: NewUser): Promise<UserProfile> {
    const email = input.email?.toLowerCase() ?? null;
    const phone = normalizePhone(input.phone);
    if ([...this.users.values()].some((user) => email && user.email?.toLowerCase() === email)) {
      throw new Error("An account already exists for that email");
    }
    if ([...this.users.values()].some((user) => phone && normalizePhone(user.phone) === phone)) {
      throw new Error("An account already exists for that phone number");
    }
    const username = normalizeUsername(input.username ?? input.fullName);
    if ([...this.users.values()].some((user) => user.username === username)) {
      throw new Error("That display name is already taken");
    }
    const user: StoredUser = {
      ...input,
      id: randomUUID(),
      email,
      phone,
      username,
      onboardingComplete: input.onboardingComplete ?? true,
      accountType: "member",
      preferences: { ...defaultPreferences, ...input.preferences },
    };
    this.users.set(user.id, user);
    this.seedWelcomeChats(user.id);
    return publicUser(user);
  }

  async ensureAuthUser(input: AuthIdentityInput): Promise<UserProfile> {
    const existing = this.users.get(input.id);
    if (existing) {
      const next = {
        ...existing,
        email: input.email.toLowerCase(),
        fullName: existing.onboardingComplete ? existing.fullName : input.fullName,
        photoUrl: existing.onboardingComplete ? existing.photoUrl : input.photoUrl,
        username: existing.username ?? (input.username ? normalizeUsername(input.username) : null),
      };
      this.users.set(input.id, next);
      return publicUser(next);
    }
    const user: StoredUser = {
      id: input.id,
      fullName: input.fullName,
      username: input.username ? normalizeUsername(input.username) : null,
      email: input.email.toLowerCase(),
      phone: null,
      passwordHash: null,
      dateOfBirth: null,
      gender: null,
      preferredLanguage: "English",
      area: null,
      photoUrl: input.photoUrl,
      onboardingComplete: false,
      accountType: "member",
      preferences: structuredClone(defaultPreferences),
    };
    this.users.set(user.id, user);
    this.seedWelcomeChats(user.id);
    return publicUser(user);
  }

  async completeProfile(userId: string, input: CompleteProfileInput): Promise<UserProfile> {
    const user = this.requireUser(userId);
    const username = normalizeUsername(input.username);
    if ([...this.users.values()].some((candidate) => candidate.id !== userId && candidate.username === username)) {
      throw new Error("That display name is already taken");
    }
    const next: StoredUser = {
      ...user,
      ...input,
      username,
      phone: normalizePhone(input.phone),
      onboardingComplete: true,
      preferences: { ...user.preferences, ...input.preferences },
    };
    this.users.set(userId, next);
    return publicUser(next);
  }

  async updatePhoto(userId: string, photoUrl: string | null): Promise<UserProfile> {
    const user = this.requireUser(userId);
    const next = { ...user, photoUrl };
    this.users.set(userId, next);
    return publicUser(next);
  }

  async isUsernameAvailable(username: string, excludeUserId?: string): Promise<boolean> {
    const normalized = normalizeUsername(username);
    return ![...this.users.values()].some((user) => user.id !== excludeUserId && user.username === normalized);
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

  async listContacts(userId: string, query = ""): Promise<ChatContact[]> {
    this.requireUser(userId);
    const normalizedQuery = query.trim().toLowerCase();
    const usernameQuery = normalizeUsername(query);
    return [...this.users.values()]
      .filter((user) => user.id !== userId && user.onboardingComplete)
      .filter((user) => this.canDiscover(userId, user.id))
      .filter((user) => !this.isBlockedEitherWay(userId, user.id))
      .filter((user) => !normalizedQuery || user.fullName.toLowerCase().includes(normalizedQuery) || user.username?.includes(usernameQuery))
      .map((user) => ({ id: user.id, fullName: user.fullName, username: user.username, photoUrl: user.photoUrl }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async listBlockedUsers(userId: string): Promise<ChatContact[]> {
    this.requireUser(userId);
    return [...this.blockedPairs]
      .filter((key) => key.startsWith(`${userId}:`))
      .map((key) => this.users.get(key.slice(userId.length + 1)))
      .filter((user): user is StoredUser => Boolean(user))
      .map((user) => ({ id: user.id, fullName: user.fullName, username: user.username, photoUrl: user.photoUrl }));
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    this.requireUser(userId);
    return [...this.conversations.values()]
      .filter((conversation) => conversation.memberIds.includes(userId))
      .filter((conversation) => !this.deletedConversations.has(deletionKey(userId, conversation.id)))
      .map((conversation) => this.toSummary(userId, conversation))
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }

  async createConversation(userId: string, input: { type: "direct" | "group"; participantIds: string[]; title?: string; systemInitiated?: boolean }): Promise<ConversationSummary> {
    this.requireUser(userId);
    const participantIds = [...new Set(input.participantIds.filter((id) => id !== userId))];
    participantIds.forEach((id) => this.requireUser(id));
    if (participantIds.some((id) => this.isBlockedEitherWay(userId, id))) {
      throw new Error("You cannot start a chat with a blocked contact");
    }
    const memberIds = [userId, ...participantIds];
    const directKey = input.type === "direct" ? [...memberIds].sort().join(":") : null;
    const existing = directKey
      ? [...this.conversations.values()].find((conversation) => conversation.directKey === directKey)
      : undefined;
    if (existing) {
      this.deletedConversations.delete(deletionKey(userId, existing.id));
      return this.toSummary(userId, existing);
    }
    if (input.type === "direct" && !input.systemInitiated && !this.canStartDirectMessage(userId, participantIds[0])) {
      throw new Error("This person is not accepting new direct messages");
    }
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

  async deleteConversation(userId: string, conversationId: string): Promise<void> {
    this.requireConversationMember(userId, conversationId);
    this.deletedConversations.add(deletionKey(userId, conversationId));
  }

  async leaveConversation(userId: string, conversationId: string): Promise<void> {
    const conversation = this.requireConversationMember(userId, conversationId);
    if (conversation.type !== "group") throw new Error("Direct messages cannot be left");
    conversation.memberIds = conversation.memberIds.filter((id) => id !== userId);
    if (conversation.memberIds.length === 0) {
      this.conversations.delete(conversationId);
      this.messages.delete(conversationId);
    } else {
      conversation.updatedAt = new Date().toISOString();
    }
  }

  async blockUser(userId: string, blockedUserId: string): Promise<void> {
    this.requireUser(userId);
    this.requireUser(blockedUserId);
    if (userId === blockedUserId) throw new Error("You cannot block yourself");
    this.blockedPairs.add(blockKey(userId, blockedUserId));
  }

  async unblockUser(userId: string, blockedUserId: string): Promise<void> {
    this.requireUser(userId);
    this.blockedPairs.delete(blockKey(userId, blockedUserId));
  }

  async listMessages(userId: string, conversationId: string): Promise<ChatMessage[]> {
    this.requireConversationMember(userId, conversationId);
    this.lastReadAt.set(readKey(conversationId, userId), new Date().toISOString());
    return (this.messages.get(conversationId) ?? []).map((message) => this.toMessage(userId, message));
  }

  async sendMessage(userId: string, conversationId: string, body: string): Promise<ChatMessage> {
    const conversation = this.requireConversationMember(userId, conversationId);
    if (conversation.type === "direct" && conversation.memberIds.some((id) => id !== userId && this.isBlockedEitherWay(userId, id))) {
      throw new Error("This conversation is unavailable because one participant is blocked");
    }
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
      otherUserId: conversation.type === "direct" ? other?.id ?? null : null,
      blocked: conversation.type === "direct" && Boolean(other?.id && this.isBlockedEitherWay(userId, other.id)),
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
      receipt: message.senderId === userId ? this.receiptFor(userId, message) : undefined,
    };
  }

  private receiptFor(userId: string, message: MemoryMessage): "delivered" | "read" {
    const conversation = this.conversations.get(message.conversationId);
    if (!conversation) return "delivered";
    const recipients = conversation.memberIds.filter((memberId) => memberId !== userId);
    const allRecipientsRead = recipients.length > 0 && recipients.every((memberId) => {
      const lastRead = this.lastReadAt.get(readKey(conversation.id, memberId));
      return Boolean(lastRead && Date.parse(lastRead) >= Date.parse(message.createdAt));
    });
    return allRecipientsRead ? "read" : "delivered";
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

  private isBlockedEitherWay(userId: string, otherUserId: string) {
    return this.blockedPairs.has(blockKey(userId, otherUserId)) || this.blockedPairs.has(blockKey(otherUserId, userId));
  }

  private canDiscover(userId: string, otherUserId: string) {
    const other = this.requireUser(otherUserId);
    return other.preferences.profileVisibility === "community"
      || (other.preferences.profileVisibility === "connections" && this.hasConnection(userId, otherUserId));
  }

  private canStartDirectMessage(userId: string, otherUserId: string | undefined) {
    if (!otherUserId) return false;
    const other = this.requireUser(otherUserId);
    if (other.preferences.profileVisibility === "private" || other.preferences.messagePrivacy === "nobody") return false;
    if (other.preferences.profileVisibility === "connections" || other.preferences.messagePrivacy === "connections") return this.hasConnection(userId, otherUserId);
    return true;
  }

  private hasConnection(userId: string, otherUserId: string) {
    return [...this.conversations.values()].some((conversation) => conversation.memberIds.includes(userId) && conversation.memberIds.includes(otherUserId));
  }
}

function readKey(conversationId: string, userId: string) {
  return `${conversationId}:${userId}`;
}

function blockKey(blockerId: string, blockedId: string) {
  return `${blockerId}:${blockedId}`;
}

function deletionKey(userId: string, conversationId: string) {
  return `${userId}:${conversationId}`;
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const plus = phone.trim().startsWith("+") ? "+" : "";
  return `${plus}${phone.replace(/\D/g, "")}`;
}

export const seededCommunityMembers = communityMembers;
