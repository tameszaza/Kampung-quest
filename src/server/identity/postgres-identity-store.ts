import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { AuthIdentityInput, CompleteProfileInput, IdentityStore, NewUser } from "@/server/identity/identity-store";
import { normalizePhone, seededCommunityMembers } from "@/server/identity/identity-store";
import type {
  ChatContact,
  ChatMessage,
  ConversationSummary,
  StoredUser,
  ChatProfile,
  EmergencyContact,
  UserPreferences,
  UserProfile,
} from "@/server/identity/types";
import { defaultPreferences, publicUser } from "@/server/identity/types";
import { normalizeUsername } from "@/server/identity/username";

type UserRow = {
  user_id: string;
  full_name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  password_hash: string | null;
  date_of_birth: Date | string | null;
  gender: string | null;
  preferred_language: string;
  area: string | null;
  photo_url: string | null;
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_email: string | null;
  account_type: "member" | "community";
  onboarding_complete: boolean;
  interests: string[] | null;
  group_size: UserPreferences["groupSize"] | null;
  activity_level: UserPreferences["activityLevel"] | null;
  accessibility_needs: string[] | null;
  text_size: UserPreferences["textSize"] | null;
  high_contrast: boolean | null;
  message_notifications: boolean | null;
  quest_notifications: boolean | null;
  profile_visibility: UserPreferences["profileVisibility"] | null;
  message_privacy: UserPreferences["messagePrivacy"] | null;
  show_online_status: boolean | null;
};

const userSelect = `
  SELECT u.user_id, u.full_name, u.username, u.email, u.phone, u.password_hash, u.date_of_birth,
         u.gender, u.preferred_language, u.area, u.photo_url,
         u.emergency_contact_name, u.emergency_contact_relationship,
         u.emergency_contact_phone, u.emergency_contact_email,
         u.account_type, u.onboarding_complete,
         p.interests, p.group_size, p.activity_level, p.accessibility_needs,
         p.text_size, p.high_contrast, p.message_notifications, p.quest_notifications,
         p.profile_visibility, p.message_privacy, p.show_online_status
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
      const username = normalizeUsername(input.username ?? input.fullName);
      await client.query(
        `INSERT INTO identity.users
           (user_id, full_name, email, phone, password_hash, date_of_birth, gender,
            preferred_language, area, photo_url, account_type, username, onboarding_complete)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'member', $11, $12)`,
        [
          id, input.fullName, input.email?.toLowerCase() ?? null, normalizePhone(input.phone),
          input.passwordHash, input.dateOfBirth || null, input.gender || null,
          input.preferredLanguage, input.area || null, input.photoUrl, username,
          input.onboardingComplete ?? true,
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
      if (username === "test") await this.seedWelcomeChatsIfNeeded(client, id, username);
      await client.query("COMMIT");
      return publicUser({
        ...input,
        id,
        username,
        onboardingComplete: input.onboardingComplete ?? true,
        email: input.email?.toLowerCase() ?? null,
        phone: normalizePhone(input.phone),
        emergencyContact: input.emergencyContact ?? null,
        accountType: "member",
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) throw new Error("An account already exists for that email or phone number");
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureAuthUser(input: AuthIdentityInput): Promise<UserProfile> {
    await this.ensureCommunityMembers(this.pool);
    const username = input.username ? normalizeUsername(input.username) : null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.id]);
      await client.query(
        `INSERT INTO identity.users
           (user_id, full_name, username, email, phone, password_hash, preferred_language,
            photo_url, account_type, onboarding_complete)
         VALUES ($1, $2, $3, lower($4), NULL, NULL, 'English', $5, 'member', false)
         ON CONFLICT (user_id) DO UPDATE SET
           email = lower(EXCLUDED.email),
           full_name = CASE WHEN identity.users.onboarding_complete THEN identity.users.full_name ELSE EXCLUDED.full_name END,
           username = COALESCE(identity.users.username, EXCLUDED.username),
           photo_url = CASE WHEN identity.users.onboarding_complete THEN identity.users.photo_url ELSE COALESCE(identity.users.photo_url, EXCLUDED.photo_url) END,
           updated_at = now()`,
        [input.id, input.fullName, username, input.email, input.photoUrl],
      );
      await client.query(
        `INSERT INTO identity.user_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [input.id],
      );
      await this.seedWelcomeChatsIfNeeded(client, input.id, username);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const user = await this.findUserById(input.id);
    if (!user) throw new Error("User not found");
    return publicUser(user);
  }

  async completeProfile(userId: string, input: CompleteProfileInput): Promise<UserProfile> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const username = normalizeUsername(input.username);
      await client.query(
        `UPDATE identity.users SET
           full_name = $2, username = $3, phone = $4, date_of_birth = $5, gender = $6,
           preferred_language = $7, area = $8, photo_url = $9,
           onboarding_complete = true, updated_at = now()
         WHERE user_id = $1`,
        [
          userId, input.fullName, username, normalizePhone(input.phone),
          input.dateOfBirth, input.gender, input.preferredLanguage, input.area, input.photoUrl,
        ],
      );
      await client.query(
        `UPDATE identity.user_preferences SET interests = $2, group_size = $3,
           activity_level = $4, updated_at = now() WHERE user_id = $1`,
        [userId, input.preferences.interests, input.preferences.groupSize, input.preferences.activityLevel],
      );
      await this.seedWelcomeChatsIfNeeded(client, userId, username);
      const result = await client.query<UserRow>(`${userSelect} WHERE u.user_id = $1`, [userId]);
      if (!result.rows[0]) throw new Error("User not found");
      await client.query("COMMIT");
      return publicUser(this.mapUser(result.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) throw new Error("That display name is already taken");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateProfile(userId: string, input: { fullName: string; phone: string | null; emergencyContact: EmergencyContact | null }): Promise<UserProfile> {
    try {
      const result = await this.pool.query<UserRow>(
        `UPDATE identity.users SET
           full_name = $2, phone = $3,
           emergency_contact_name = $4,
           emergency_contact_relationship = $5,
           emergency_contact_phone = $6,
           emergency_contact_email = $7,
           updated_at = now()
         WHERE user_id = $1
         RETURNING user_id`,
        [
          userId,
          input.fullName.trim(),
          normalizePhone(input.phone),
          input.emergencyContact?.name.trim() ?? null,
          input.emergencyContact?.relationship.trim() ?? null,
          input.emergencyContact ? normalizePhone(input.emergencyContact.phone) : null,
          input.emergencyContact?.email?.trim().toLowerCase() || null,
        ],
      );
      if (!result.rowCount) throw new Error("User not found");
      const user = await this.findUserById(userId);
      if (!user) throw new Error("User not found");
      return publicUser(user);
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("That phone number is already in use");
      throw error;
    }
  }

  async updatePhoto(userId: string, photoUrl: string | null): Promise<UserProfile> {
    const result = await this.pool.query<UserRow>(
      `WITH updated AS (
         UPDATE identity.users SET photo_url = $2, updated_at = now()
         WHERE user_id = $1 RETURNING user_id
       ) ${userSelect} WHERE u.user_id = (SELECT user_id FROM updated)`,
      [userId, photoUrl],
    );
    if (!result.rows[0]) throw new Error("User not found");
    return publicUser(this.mapUser(result.rows[0]));
  }

  async isUsernameAvailable(username: string, excludeUserId?: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM identity.users
       WHERE lower(username) = $1 AND ($2::text IS NULL OR user_id <> $2) LIMIT 1`,
      [normalizeUsername(username), excludeUserId ?? null],
    );
    return !result.rowCount;
  }

  async findUserById(userId: string): Promise<StoredUser | null> {
    const result = await this.pool.query<UserRow>(`${userSelect} WHERE u.user_id = $1`, [userId]);
    return result.rows[0] ? this.mapUser(result.rows[0]) : null;
  }

  async getChatProfile(viewerId: string, targetId: string, conversationId: string): Promise<ChatProfile> {
    const result = await this.pool.query<{
      user_id: string;
      full_name: string;
      username: string | null;
      email: string | null;
      phone: string | null;
      photo_url: string | null;
      emergency_contact_name: string | null;
      emergency_contact_relationship: string | null;
      emergency_contact_phone: string | null;
      emergency_contact_email: string | null;
    }>(
      `SELECT target.user_id, target.full_name, target.username, target.email, target.phone, target.photo_url,
              target.emergency_contact_name, target.emergency_contact_relationship,
              target.emergency_contact_phone, target.emergency_contact_email
       FROM identity.users target
       JOIN chat.conversation_members viewer_member
         ON viewer_member.conversation_id = $3 AND viewer_member.user_id = $1
       JOIN chat.conversation_members target_member
         ON target_member.conversation_id = viewer_member.conversation_id AND target_member.user_id = target.user_id
       WHERE target.user_id = $2`,
      [viewerId, targetId, conversationId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Profile is not part of this conversation");
    return {
      id: row.user_id,
      fullName: row.full_name,
      username: row.username,
      email: row.email,
      phone: row.phone,
      photoUrl: row.photo_url,
      emergencyContact: row.emergency_contact_name && row.emergency_contact_phone
        ? {
            name: row.emergency_contact_name,
            relationship: row.emergency_contact_relationship ?? "Emergency contact",
            phone: row.emergency_contact_phone,
            email: row.emergency_contact_email,
          }
        : null,
    };
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
           profile_visibility = COALESCE($10, profile_visibility),
           message_privacy = COALESCE($11, message_privacy),
           show_online_status = COALESCE($12, show_online_status),
           updated_at = now()
         WHERE user_id = $1`,
        [
          userId, input.interests ?? null, input.groupSize ?? null, input.activityLevel ?? null,
          input.accessibilityNeeds ?? null, input.textSize ?? null, input.highContrast ?? null,
          input.messageNotifications ?? null, input.questNotifications ?? null,
          input.profileVisibility ?? null, input.messagePrivacy ?? null, input.showOnlineStatus ?? null,
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

  async listContacts(userId: string, query = ""): Promise<ChatContact[]> {
    await this.ensureCommunityMembers(this.pool);
    const normalizedQuery = query.trim().toLowerCase();
    const usernameQuery = normalizeUsername(query);
    const result = await this.pool.query<{ user_id: string; full_name: string; username: string | null; photo_url: string | null }>(
      `SELECT candidate.user_id, candidate.full_name, candidate.username, candidate.photo_url FROM identity.users candidate
       LEFT JOIN identity.user_preferences privacy ON privacy.user_id = candidate.user_id
       WHERE candidate.user_id <> $1 AND candidate.onboarding_complete = true
         AND (
           COALESCE(privacy.profile_visibility, 'community') = 'community'
           OR (
             COALESCE(privacy.profile_visibility, 'community') = 'connections'
             AND EXISTS (
               SELECT 1
               FROM chat.conversation_members mine
               JOIN chat.conversation_members theirs ON theirs.conversation_id = mine.conversation_id
               WHERE mine.user_id = $1 AND theirs.user_id = candidate.user_id
             )
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM chat.user_blocks block
           WHERE (block.blocker_id = $1 AND block.blocked_id = candidate.user_id)
              OR (block.blocker_id = candidate.user_id AND block.blocked_id = $1)
         )
         AND ($2 = '' OR lower(candidate.full_name) LIKE '%' || $2 || '%' OR lower(COALESCE(candidate.username, '')) LIKE '%' || $3 || '%')
       ORDER BY CASE WHEN candidate.account_type = 'community' THEN 0 ELSE 1 END, candidate.full_name`,
      [userId, normalizedQuery, usernameQuery],
    );
    return result.rows.map((row) => ({ id: row.user_id, fullName: row.full_name, username: row.username, photoUrl: row.photo_url }));
  }

  async listBlockedUsers(userId: string): Promise<ChatContact[]> {
    const result = await this.pool.query<{ user_id: string; full_name: string; username: string | null; photo_url: string | null }>(
      `SELECT blocked.user_id, blocked.full_name, blocked.username, blocked.photo_url
       FROM chat.user_blocks block
       JOIN identity.users blocked ON blocked.user_id = block.blocked_id
       WHERE block.blocker_id = $1
       ORDER BY blocked.full_name`,
      [userId],
    );
    return result.rows.map((row) => ({ id: row.user_id, fullName: row.full_name, username: row.username, photoUrl: row.photo_url }));
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const result = await this.pool.query<{
      conversation_id: string; conversation_type: "direct" | "group"; display_title: string;
      display_image: string | null; preview: string | null; last_message_at: Date | string;
      unread_count: string | number; member_count: string | number; other_user_id: string | null; blocked: boolean;
    }>(
      `SELECT c.conversation_id, c.conversation_type,
              COALESCE(c.title, other.full_name, 'Conversation') AS display_title,
              COALESCE(c.image_url, other.photo_url) AS display_image,
              other.user_id AS other_user_id,
              latest.body AS preview,
              COALESCE(latest.created_at, c.updated_at) AS last_message_at,
              (SELECT count(*) FROM chat.messages unread
               WHERE unread.conversation_id = c.conversation_id
                 AND unread.created_at > self.last_read_at
                 AND unread.sender_id IS DISTINCT FROM $1) AS unread_count,
              (SELECT count(*) FROM chat.conversation_members members
               WHERE members.conversation_id = c.conversation_id) AS member_count
              ,(c.conversation_type = 'direct' AND EXISTS (
                SELECT 1
                FROM chat.conversation_members blocked_member
                JOIN chat.user_blocks block
                  ON (block.blocker_id = $1 AND block.blocked_id = blocked_member.user_id)
                  OR (block.blocker_id = blocked_member.user_id AND block.blocked_id = $1)
                WHERE blocked_member.conversation_id = c.conversation_id AND blocked_member.user_id <> $1
              )) AS blocked
       FROM chat.conversations c
       JOIN chat.conversation_members self
         ON self.conversation_id = c.conversation_id AND self.user_id = $1
       LEFT JOIN LATERAL (
         SELECT u.user_id, u.full_name, u.photo_url
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
       WHERE NOT EXISTS (
         SELECT 1 FROM chat.conversation_deletions deletion
         WHERE deletion.conversation_id = c.conversation_id AND deletion.user_id = $1
       )
       AND (
         EXISTS (
           SELECT 1 FROM identity.users viewer
           WHERE viewer.user_id = $1 AND viewer.username = 'test'
         )
         OR NOT (
           (c.conversation_type = 'group' AND c.title = 'Cooking Buddies' AND c.created_by = 'community_anne')
           OR (c.conversation_type = 'direct' AND c.created_by = 'community_anne' AND other.user_id = 'community_anne')
         )
       )
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
      otherUserId: row.conversation_type === "direct" ? row.other_user_id : null,
      blocked: row.blocked,
    }));
  }

  async createConversation(userId: string, input: { type: "direct" | "group"; participantIds: string[]; title?: string; systemInitiated?: boolean }): Promise<ConversationSummary> {
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
      const blocked = await client.query(
        `SELECT 1 FROM chat.user_blocks
         WHERE (blocker_id = $1 AND blocked_id = ANY($2::text[]))
            OR (blocked_id = $1 AND blocker_id = ANY($2::text[]))
         LIMIT 1`,
        [userId, participantIds],
      );
      if (blocked.rowCount) throw new Error("You cannot start a chat with a blocked contact");
      let conversationId: string;
      if (input.type === "direct") {
        const directKey = [...memberIds].sort().join(":");
        const existing = await client.query<{ conversation_id: string; created_by: string | null }>(
          "SELECT conversation_id, created_by FROM chat.conversations WHERE direct_key = $1",
          [directKey],
        );
        if (existing.rows[0]?.created_by === "community_anne") {
          const viewer = await client.query<{ username: string | null }>(
            "SELECT username FROM identity.users WHERE user_id = $1",
            [userId],
          );
          if (viewer.rows[0]?.username !== "test") {
            await client.query("DELETE FROM chat.messages WHERE conversation_id = $1", [existing.rows[0].conversation_id]);
            await client.query(
              "UPDATE chat.conversations SET created_by = $2, updated_at = now() WHERE conversation_id = $1",
              [existing.rows[0].conversation_id, userId],
            );
          }
        }
        if (!existing.rowCount) {
          const privacy = await client.query<{ profile_visibility: UserPreferences["profileVisibility"] | null; message_privacy: UserPreferences["messagePrivacy"] | null }>(
            `SELECT COALESCE(p.profile_visibility, 'community') AS profile_visibility,
                    COALESCE(p.message_privacy, 'everyone') AS message_privacy
             FROM identity.user_preferences p
             WHERE p.user_id = $1`,
            [participantIds[0]],
          );
          const target = privacy.rows[0];
          if (!input.systemInitiated && (target?.profile_visibility === "private" || target?.message_privacy === "nobody")) {
            throw new Error("This person is not accepting new direct messages");
          }
          if (!input.systemInitiated && (target?.profile_visibility === "connections" || target?.message_privacy === "connections")) {
            throw new Error("You can message this person after you have an existing connection");
          }
        }
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
      await client.query(
        `DELETE FROM chat.conversation_deletions
         WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, userId],
      );
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

  async ensureQuestGroupConversation(questId: string, title: string, memberIds: string[]): Promise<void> {
    const uniqueMemberIds = [...new Set(memberIds)];
    if (!uniqueMemberIds.length) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const users = await client.query<{ user_id: string }>(
        "SELECT user_id FROM identity.users WHERE user_id = ANY($1::text[])",
        [uniqueMemberIds],
      );
      if (users.rows.length !== uniqueMemberIds.length) throw new Error("One or more quest participants were not found");
      const directKey = `quest:${questId}`;
      const existing = await client.query<{ conversation_id: string }>(
        `SELECT conversation_id FROM chat.conversations
         WHERE conversation_type = 'group' AND direct_key = $1
         FOR UPDATE`,
        [directKey],
      );
      const conversationId = existing.rows[0]?.conversation_id ?? randomUUID();
      if (!existing.rowCount) {
        await client.query(
          `INSERT INTO chat.conversations
             (conversation_id, conversation_type, title, image_url, direct_key, created_by)
           VALUES ($1, 'group', $2, '/assets/profile-group.jpg', $3, $4)`,
          [conversationId, title, directKey, uniqueMemberIds[0]],
        );
      } else {
        await client.query(
          `UPDATE chat.conversations SET title = $2, updated_at = now() WHERE conversation_id = $1`,
          [conversationId, title],
        );
      }
      for (const memberId of uniqueMemberIds) {
        await client.query(
          `INSERT INTO chat.conversation_members (conversation_id, user_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [conversationId, memberId],
        );
        await client.query(
          `DELETE FROM chat.conversation_deletions WHERE conversation_id = $1 AND user_id = $2`,
          [conversationId, memberId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteConversation(userId: string, conversationId: string): Promise<void> {
    await this.requireMember(userId, conversationId);
    await this.pool.query(
      `INSERT INTO chat.conversation_deletions (conversation_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET deleted_at = now()`,
      [conversationId, userId],
    );
  }

  async leaveConversation(userId: string, conversationId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const conversation = await client.query<{ conversation_type: "direct" | "group" }>(
        `SELECT c.conversation_type
         FROM chat.conversations c
         JOIN chat.conversation_members m ON m.conversation_id = c.conversation_id
         WHERE c.conversation_id = $1 AND m.user_id = $2
         FOR UPDATE OF c`,
        [conversationId, userId],
      );
      if (!conversation.rows[0]) throw new Error("Conversation not found");
      if (conversation.rows[0].conversation_type !== "group") throw new Error("Direct messages cannot be left");
      await client.query(
        "DELETE FROM chat.conversation_members WHERE conversation_id = $1 AND user_id = $2",
        [conversationId, userId],
      );
      await client.query(
        `DELETE FROM chat.conversations conversation
         WHERE conversation.conversation_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM chat.conversation_members member
             WHERE member.conversation_id = conversation.conversation_id
           )`,
        [conversationId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async blockUser(userId: string, blockedUserId: string): Promise<void> {
    if (userId === blockedUserId) throw new Error("You cannot block yourself");
    const users = await this.pool.query(
      "SELECT count(*) AS count FROM identity.users WHERE user_id = ANY($1::text[])",
      [[userId, blockedUserId]],
    );
    if (Number(users.rows[0]?.count ?? 0) !== 2) throw new Error("User not found");
    await this.pool.query(
      `INSERT INTO chat.user_blocks (blocker_id, blocked_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, blockedUserId],
    );
  }

  async unblockUser(userId: string, blockedUserId: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM chat.user_blocks WHERE blocker_id = $1 AND blocked_id = $2",
      [userId, blockedUserId],
    );
  }

  async listMessages(userId: string, conversationId: string): Promise<ChatMessage[]> {
    await this.requireMember(userId, conversationId);
    const result = await this.pool.query<{
      message_id: string; conversation_id: string; sender_id: string | null; body: string;
      created_at: Date | string; full_name: string | null; photo_url: string | null;
      receipt: "delivered" | "read" | null;
    }>(
      `SELECT message.message_id, message.conversation_id, message.sender_id, message.body,
              message.created_at, sender.full_name, sender.photo_url,
              CASE WHEN message.sender_id = $2 THEN
                CASE WHEN NOT EXISTS (
                  SELECT 1
                  FROM chat.conversation_members recipient
                  WHERE recipient.conversation_id = message.conversation_id
                    AND recipient.user_id <> $2
                    AND recipient.last_read_at < message.created_at
                ) THEN 'read' ELSE 'delivered' END
              ELSE NULL END AS receipt
       FROM chat.messages message
       LEFT JOIN identity.users sender ON sender.user_id = message.sender_id
       WHERE message.conversation_id = $1
       ORDER BY message.created_at ASC
       LIMIT 300`,
      [conversationId, userId],
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
      receipt: row.sender_id === userId ? (row.receipt ?? "delivered") : undefined,
    }));
  }

  async sendMessage(userId: string, conversationId: string, body: string): Promise<ChatMessage> {
    await this.requireMember(userId, conversationId);
    const blocked = await this.pool.query(
      `SELECT 1
       FROM chat.conversations c
       JOIN chat.conversation_members member ON member.conversation_id = c.conversation_id
       JOIN chat.user_blocks block
         ON (block.blocker_id = $1 AND block.blocked_id = member.user_id)
         OR (block.blocker_id = member.user_id AND block.blocked_id = $1)
       WHERE c.conversation_id = $2 AND c.conversation_type = 'direct' AND member.user_id <> $1
       LIMIT 1`,
      [userId, conversationId],
    );
    if (blocked.rowCount) throw new Error("This conversation is unavailable because one participant is blocked");
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
      receipt: "delivered",
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
            photo_url, account_type, username, onboarding_complete)
         VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, 'community', $8, true)
         ON CONFLICT (user_id) DO UPDATE SET onboarding_complete = true,
           username = COALESCE(identity.users.username, EXCLUDED.username)`,
        [
          user.id, user.fullName, user.email, user.phone, user.preferredLanguage,
          user.area, user.photoUrl, user.username,
        ],
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

  private async seedWelcomeChatsIfNeeded(client: PoolClient, userId: string, username: string | null) {
    if (username !== "test") return;
    const existing = await client.query(
      `SELECT 1
       FROM chat.conversations c
       JOIN chat.conversation_members member ON member.conversation_id = c.conversation_id
       WHERE member.user_id = $1 AND c.conversation_type = 'group'
         AND c.title = 'Cooking Buddies' AND c.created_by = 'community_anne'
       LIMIT 1`,
      [userId],
    );
    if (!existing.rowCount) await this.seedWelcomeChats(client, userId);
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
      username: row.username,
      email: row.email,
      phone: row.phone,
      passwordHash: row.password_hash,
      dateOfBirth: row.date_of_birth ? asIsoDate(row.date_of_birth) : null,
      gender: row.gender,
      preferredLanguage: row.preferred_language,
      area: row.area,
      photoUrl: row.photo_url,
      emergencyContact: row.emergency_contact_name && row.emergency_contact_phone
        ? {
            name: row.emergency_contact_name,
            relationship: row.emergency_contact_relationship ?? "Emergency contact",
            phone: row.emergency_contact_phone,
            email: row.emergency_contact_email,
          }
        : null,
      accountType: row.account_type,
      onboardingComplete: row.onboarding_complete,
      preferences: {
        interests: row.interests ?? [],
        groupSize: row.group_size ?? defaultPreferences.groupSize,
        activityLevel: row.activity_level ?? defaultPreferences.activityLevel,
        accessibilityNeeds: row.accessibility_needs ?? [],
        textSize: row.text_size ?? defaultPreferences.textSize,
        highContrast: row.high_contrast ?? false,
        messageNotifications: row.message_notifications ?? true,
        questNotifications: row.quest_notifications ?? true,
        profileVisibility: row.profile_visibility ?? defaultPreferences.profileVisibility,
        messagePrivacy: row.message_privacy ?? defaultPreferences.messagePrivacy,
        showOnlineStatus: row.show_online_status ?? defaultPreferences.showOnlineStatus,
      },
    };
  }
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asIsoDate(value: Date | string): string {
  if (value instanceof Date) {
    const year = String(value.getFullYear()).padStart(4, "0");
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function isUniqueViolation(error: unknown): error is { code: "23505" } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
