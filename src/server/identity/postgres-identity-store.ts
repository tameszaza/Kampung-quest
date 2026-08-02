import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { IdentityStore, NewUser } from "@/server/identity/identity-store";
import { normalizePhone, seededCommunityMembers } from "@/server/identity/identity-store";
import type {
  ChatContact,
  ChatMessage,
  ConversationSummary,
  StoredUser,
  UserPreferences,
  UserProfile,
} from "@/server/identity/types";
import { defaultPreferences, publicUser } from "@/server/identity/types";

type UserRow = {
  user_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  password_hash: string | null;
  date_of_birth: Date | string | null;
  gender: string | null;
  preferred_language: string;
  area: string | null;
  photo_url: string | null;
  account_type: "member" | "community";
  interests: string[] | null;
  group_size: UserPreferences["groupSize"] | null;
  activity_level: UserPreferences["activityLevel"] | null;
  accessibility_needs: string[] | null;
  text_size: UserPreferences["textSize"] | null;
  high_contrast: boolean | null;
  message_notifications: boolean | null;
  quest_notifications: boolean | null;
};

const userSelect = `
  SELECT u.user_id, u.full_name, u.email, u.phone, u.password_hash, u.date_of_birth,
         u.gender, u.preferred_language, u.area, u.photo_url, u.account_type,
         p.interests, p.group_size, p.activity_level, p.accessibility_needs,
         p.text_size, p.high_contrast, p.message_notifications, p.quest_notifications
  FROM identity.users u
  LEFT JOIN identity.user_preferences p ON p.user_id = u.user_id`;

export class PostgresIdentityStore implements IdentityStore {
  readonly pool: Pool;

  constructor(connectionString: string, pool?: Pool) {
    this.pool = pool ?? new Pool({ connectionString, max: 10 });
  }

  async createUser(input: NewUser): Promise<UserProfile> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.ensureCommunityMembers(client);
      const id = randomUUID();
      await client.query(
        `INSERT INTO identity.users
           (user_id, full_name, email, phone, password_hash, date_of_birth, gender,
            preferred_language, area, photo_url, account_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'member')`,
        [
          id, input.fullName, input.email?.toLowerCase() ?? null, normalizePhone(input.phone),
          input.passwordHash, input.dateOfBirth || null, input.gender || null,
          input.preferredLanguage, input.area || null, input.photoUrl,
        ],
      );
      await client.query(
        `INSERT INTO identity.user_preferences
           (user_id, interests, group_size, activity_level, accessibility_needs, text_size,
            high_contrast, message_notifications, quest_notifications)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id, input.preferences.interests, input.preferences.groupSize,
          input.preferences.activityLevel, input.preferences.accessibilityNeeds,
          input.preferences.textSize, input.preferences.highContrast,
          input.preferences.messageNotifications, input.preferences.questNotifications,
        ],
      );
      await this.seedWelcomeChats(client, id);
      await client.query("COMMIT");
      return publicUser({ ...input, id, email: input.email?.toLowerCase() ?? null, phone: normalizePhone(input.phone), accountType: "member" });
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) throw new Error("An account already exists for that email or phone number");
      throw error;
    } finally {
      client.release();
    }
  }

  async findUserByIdentifier(identifier: string): Promise<StoredUser | null> {
    const result = await this.pool.query<UserRow>(
      `${userSelect}
       WHERE u.account_type = 'member'
         AND (lower(u.email) = lower($1) OR u.phone = $2)
       LIMIT 1`,
      [identifier.trim(), normalizePhone(identifier)],
    );
    return result.rows[0] ? this.mapUser(result.rows[0]) : null;
  }

  async findUserById(userId: string): Promise<StoredUser | null> {
    const result = await this.pool.query<UserRow>(`${userSelect} WHERE u.user_id = $1`, [userId]);
    return result.rows[0] ? this.mapUser(result.rows[0]) : null;
  }

  async updatePreferences(userId: string, input: Partial<UserPreferences> & { preferredLanguage?: string; area?: string | null }): Promise<UserProfile> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (input.preferredLanguage !== undefined || input.area !== undefined) {
        await client.query(
          `UPDATE identity.users
           SET preferred_language = COALESCE($2, preferred_language),
               area = CASE WHEN $3::boolean THEN $4 ELSE area END,
               updated_at = now()
           WHERE user_id = $1`,
          [userId, input.preferredLanguage ?? null, input.area !== undefined, input.area ?? null],
        );
      }
      await client.query(
        `UPDATE identity.user_preferences SET
           interests = COALESCE($2, interests),
           group_size = COALESCE($3, group_size),
           activity_level = COALESCE($4, activity_level),
           accessibility_needs = COALESCE($5, accessibility_needs),
           text_size = COALESCE($6, text_size),
           high_contrast = COALESCE($7, high_contrast),
           message_notifications = COALESCE($8, message_notifications),
           quest_notifications = COALESCE($9, quest_notifications),
           updated_at = now()
         WHERE user_id = $1`,
        [
          userId, input.interests ?? null, input.groupSize ?? null, input.activityLevel ?? null,
          input.accessibilityNeeds ?? null, input.textSize ?? null, input.highContrast ?? null,
          input.messageNotifications ?? null, input.questNotifications ?? null,
        ],
      );
      const result = await client.query<UserRow>(`${userSelect} WHERE u.user_id = $1`, [userId]);
      if (!result.rows[0]) throw new Error("User not found");
      await client.query("COMMIT");
      return publicUser(this.mapUser(result.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createSession(sessionHash: string, userId: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO identity.sessions (session_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
      [sessionHash, userId, expiresAt],
    );
  }

  async findUserBySession(sessionHash: string): Promise<UserProfile | null> {
    const result = await this.pool.query<UserRow>(
      `${userSelect}
       JOIN identity.sessions s ON s.user_id = u.user_id
       WHERE s.session_hash = $1 AND s.expires_at > now()`,
      [sessionHash],
    );
    return result.rows[0] ? publicUser(this.mapUser(result.rows[0])) : null;
  }

  async deleteSession(sessionHash: string): Promise<void> {
    await this.pool.query("DELETE FROM identity.sessions WHERE session_hash = $1", [sessionHash]);
  }

  async listContacts(userId: string): Promise<ChatContact[]> {
    await this.ensureCommunityMembers(this.pool);
    const result = await this.pool.query<{ user_id: string; full_name: string; photo_url: string | null }>(
      `SELECT user_id, full_name, photo_url FROM identity.users
       WHERE user_id <> $1
       ORDER BY CASE WHEN account_type = 'community' THEN 0 ELSE 1 END, full_name`,
      [userId],
    );
    return result.rows.map((row) => ({ id: row.user_id, fullName: row.full_name, photoUrl: row.photo_url }));
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const result = await this.pool.query<{
      conversation_id: string; conversation_type: "direct" | "group"; display_title: string;
      display_image: string | null; preview: string | null; last_message_at: Date | string;
      unread_count: string | number; member_count: string | number;
    }>(
      `SELECT c.conversation_id, c.conversation_type,
              COALESCE(c.title, other.full_name, 'Conversation') AS display_title,
              COALESCE(c.image_url, other.photo_url) AS display_image,
              latest.body AS preview,
              COALESCE(latest.created_at, c.updated_at) AS last_message_at,
              (SELECT count(*) FROM chat.messages unread
               WHERE unread.conversation_id = c.conversation_id
                 AND unread.created_at > self.last_read_at
                 AND unread.sender_id IS DISTINCT FROM $1) AS unread_count,
              (SELECT count(*) FROM chat.conversation_members members
               WHERE members.conversation_id = c.conversation_id) AS member_count
       FROM chat.conversations c
       JOIN chat.conversation_members self
         ON self.conversation_id = c.conversation_id AND self.user_id = $1
       LEFT JOIN LATERAL (
         SELECT u.full_name, u.photo_url
         FROM chat.conversation_members member
         JOIN identity.users u ON u.user_id = member.user_id
         WHERE member.conversation_id = c.conversation_id AND member.user_id <> $1
         ORDER BY member.joined_at LIMIT 1
       ) other ON true
       LEFT JOIN LATERAL (
         SELECT body, created_at FROM chat.messages message
         WHERE message.conversation_id = c.conversation_id
         ORDER BY created_at DESC LIMIT 1
       ) latest ON true
       ORDER BY last_message_at DESC`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.conversation_id,
      type: row.conversation_type,
      title: row.display_title,
      imageUrl: row.display_image,
      preview: row.preview ?? "Start the conversation",
      lastMessageAt: asIso(row.last_message_at),
      unreadCount: Number(row.unread_count),
      memberCount: Number(row.member_count),
    }));
  }

  async createConversation(userId: string, input: { type: "direct" | "group"; participantIds: string[]; title?: string }): Promise<ConversationSummary> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const participantIds = [...new Set(input.participantIds.filter((id) => id !== userId))];
      const users = await client.query<{ user_id: string }>(
        "SELECT user_id FROM identity.users WHERE user_id = ANY($1::text[])",
        [participantIds],
      );
      if (users.rows.length !== participantIds.length) throw new Error("One or more users were not found");
      const memberIds = [userId, ...participantIds];
      let conversationId: string;
      if (input.type === "direct") {
        const directKey = [...memberIds].sort().join(":");
        const created = await client.query<{ conversation_id: string }>(
          `INSERT INTO chat.conversations
             (conversation_id, conversation_type, direct_key, created_by)
           VALUES ($1, 'direct', $2, $3)
           ON CONFLICT (direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key
           RETURNING conversation_id`,
          [randomUUID(), directKey, userId],
        );
        conversationId = created.rows[0].conversation_id;
      } else {
        conversationId = randomUUID();
        await client.query(
          `INSERT INTO chat.conversations
             (conversation_id, conversation_type, title, image_url, created_by)
           VALUES ($1, 'group', $2, '/assets/profile-group.jpg', $3)`,
          [conversationId, input.title, userId],
        );
      }
      for (const memberId of memberIds) {
        await client.query(
          `INSERT INTO chat.conversation_members (conversation_id, user_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [conversationId, memberId],
        );
      }
      await client.query("COMMIT");
      const summary = (await this.listConversations(userId)).find((item) => item.id === conversationId);
      if (!summary) throw new Error("Conversation not found");
      return summary;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listMessages(userId: string, conversationId: string): Promise<ChatMessage[]> {
    await this.requireMember(userId, conversationId);
    const result = await this.pool.query<{
      message_id: string; conversation_id: string; sender_id: string | null; body: string;
      created_at: Date | string; full_name: string | null; photo_url: string | null;
    }>(
      `SELECT message.message_id, message.conversation_id, message.sender_id, message.body,
              message.created_at, sender.full_name, sender.photo_url
       FROM chat.messages message
       LEFT JOIN identity.users sender ON sender.user_id = message.sender_id
       WHERE message.conversation_id = $1
       ORDER BY message.created_at ASC
       LIMIT 300`,
      [conversationId],
    );
    await this.pool.query(
      `UPDATE chat.conversation_members SET last_read_at = now()
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    return result.rows.map((row) => ({
      id: row.message_id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      senderName: row.full_name ?? "Senior Quest",
      senderImageUrl: row.photo_url,
      body: row.body,
      createdAt: asIso(row.created_at),
      mine: row.sender_id === userId,
    }));
  }

  async sendMessage(userId: string, conversationId: string, body: string): Promise<ChatMessage> {
    await this.requireMember(userId, conversationId);
    const id = randomUUID();
    const result = await this.pool.query<{ created_at: Date | string }>(
      `WITH inserted AS (
         INSERT INTO chat.messages (message_id, conversation_id, sender_id, body)
         VALUES ($1, $2, $3, $4) RETURNING created_at
       )
       UPDATE chat.conversations SET updated_at = now() WHERE conversation_id = $2
       RETURNING (SELECT created_at FROM inserted) AS created_at`,
      [id, conversationId, userId, body],
    );
    const user = await this.findUserById(userId);
    return {
      id, conversationId, senderId: userId, senderName: user?.fullName ?? "You",
      senderImageUrl: user?.photoUrl ?? null, body, createdAt: asIso(result.rows[0].created_at), mine: true,
    };
  }

  private async requireMember(userId: string, conversationId: string) {
    const result = await this.pool.query(
      `SELECT 1 FROM chat.conversation_members WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    if (!result.rowCount) throw new Error("Conversation not found");
  }

  private async ensureCommunityMembers(queryable: Pool | PoolClient) {
    for (const user of seededCommunityMembers) {
      await queryable.query(
        `INSERT INTO identity.users
           (user_id, full_name, email, phone, password_hash, preferred_language, area,
            photo_url, account_type)
         VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, 'community')
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id, user.fullName, user.email, user.phone, user.preferredLanguage, user.area, user.photoUrl],
      );
      await queryable.query(
        `INSERT INTO identity.user_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [user.id],
      );
    }
  }

  private async seedWelcomeChats(client: PoolClient, userId: string) {
    const directId = randomUUID();
    await client.query(
      `INSERT INTO chat.conversations
         (conversation_id, conversation_type, direct_key, created_by)
       VALUES ($1, 'direct', $2, $3)`,
      [directId, [userId, "community_anne"].sort().join(":"), "community_anne"],
    );
    await this.addMembers(client, directId, [userId, "community_anne"]);
    await client.query(
      `INSERT INTO chat.messages (message_id, conversation_id, sender_id, body)
       VALUES ($1, $2, 'community_anne', $3)`,
      [randomUUID(), directId, "Hi! I’m Anne. Welcome to Senior Quest — message me if you need help getting started. 😊"],
    );

    const groupId = randomUUID();
    await client.query(
      `INSERT INTO chat.conversations
         (conversation_id, conversation_type, title, image_url, created_by)
       VALUES ($1, 'group', 'Cooking Buddies', '/assets/profile-group.jpg', 'community_anne')`,
      [groupId],
    );
    await this.addMembers(client, groupId, [userId, "community_anne", "community_david"]);
    await client.query(
      `INSERT INTO chat.messages (message_id, conversation_id, sender_id, body, created_at)
       VALUES ($1, $2, 'community_anne', $3, now() - interval '1 minute'),
              ($4, $2, 'community_david', $5, now())`,
      [
        randomUUID(), groupId,
        "Welcome to Cooking Buddies! We share simple recipes and plan friendly lunches here.",
        randomUUID(), "Glad you’re here! 👋",
      ],
    );
  }

  private async addMembers(client: PoolClient, conversationId: string, userIds: string[]) {
    for (const userId of userIds) {
      await client.query(
        `INSERT INTO chat.conversation_members (conversation_id, user_id) VALUES ($1, $2)`,
        [conversationId, userId],
      );
    }
  }

  private mapUser(row: UserRow): StoredUser {
    return {
      id: row.user_id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      passwordHash: row.password_hash,
      dateOfBirth: row.date_of_birth ? asIsoDate(row.date_of_birth) : null,
      gender: row.gender,
      preferredLanguage: row.preferred_language,
      area: row.area,
      photoUrl: row.photo_url,
      accountType: row.account_type,
      preferences: {
        interests: row.interests ?? [],
        groupSize: row.group_size ?? defaultPreferences.groupSize,
        activityLevel: row.activity_level ?? defaultPreferences.activityLevel,
        accessibilityNeeds: row.accessibility_needs ?? [],
        textSize: row.text_size ?? defaultPreferences.textSize,
        highContrast: row.high_contrast ?? false,
        messageNotifications: row.message_notifications ?? true,
        questNotifications: row.quest_notifications ?? true,
      },
    };
  }
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asIsoDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function isUniqueViolation(error: unknown): error is { code: "23505" } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
