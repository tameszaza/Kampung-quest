export type UserPreferences = {
  interests: string[];
  groupSize: "one-to-one" | "small" | "any";
  activityLevel: "gentle" | "moderate" | "any";
  accessibilityNeeds: string[];
  textSize: "large" | "extra-large";
  highContrast: boolean;
  messageNotifications: boolean;
  questNotifications: boolean;
  profileVisibility: "community" | "connections" | "private";
  messagePrivacy: "everyone" | "connections" | "nobody";
  showOnlineStatus: boolean;
};

export type UserProfile = {
  id: string;
  fullName: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  preferredLanguage: string;
  area: string | null;
  photoUrl: string | null;
  onboardingComplete: boolean;
  preferences: UserPreferences;
};

export type StoredUser = UserProfile & {
  passwordHash: string | null;
  accountType: "member" | "community";
};

export type ConversationSummary = {
  id: string;
  type: "direct" | "group";
  title: string;
  imageUrl: string | null;
  preview: string;
  lastMessageAt: string;
  unreadCount: number;
  memberCount: number;
  /** The other participant for a direct message; null for groups. */
  otherUserId?: string | null;
  blocked?: boolean;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string | null;
  senderName: string;
  senderImageUrl: string | null;
  body: string;
  createdAt: string;
  mine: boolean;
  /** Delivery state for messages sent by the current user. Incoming messages omit this value. */
  receipt?: "delivered" | "read";
};

export type ChatContact = {
  id: string;
  fullName: string;
  username: string | null;
  photoUrl: string | null;
};

export const defaultPreferences: UserPreferences = {
  interests: [],
  groupSize: "small",
  activityLevel: "gentle",
  accessibilityNeeds: [],
  textSize: "large",
  highContrast: false,
  messageNotifications: true,
  questNotifications: true,
  profileVisibility: "community",
  messagePrivacy: "everyone",
  showOnlineStatus: true,
};

export function publicUser(user: StoredUser): UserProfile {
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    phone: user.phone,
    dateOfBirth: user.dateOfBirth,
    gender: user.gender,
    preferredLanguage: user.preferredLanguage,
    area: user.area,
    photoUrl: user.photoUrl,
    onboardingComplete: user.onboardingComplete,
    preferences: structuredClone(user.preferences),
  };
}
