CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS chat;

CREATE TABLE IF NOT EXISTS identity.users (
  user_id text PRIMARY KEY,
  full_name text NOT NULL,
  email text,
  phone text,
  password_hash text,
  date_of_birth date,
  gender text,
  preferred_language text NOT NULL DEFAULT 'English',
  area text,
  photo_url text,
  account_type text NOT NULL DEFAULT 'member' CHECK (account_type IN ('member', 'community')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CHECK (account_type = 'community' OR password_hash IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
  ON identity.users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique_idx
  ON identity.users (phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS identity.user_preferences (
  user_id text PRIMARY KEY REFERENCES identity.users(user_id) ON DELETE CASCADE,
  interests text[] NOT NULL DEFAULT '{}',
  group_size text NOT NULL DEFAULT 'small' CHECK (group_size IN ('one-to-one', 'small', 'any')),
  activity_level text NOT NULL DEFAULT 'gentle' CHECK (activity_level IN ('gentle', 'moderate', 'any')),
  accessibility_needs text[] NOT NULL DEFAULT '{}',
  text_size text NOT NULL DEFAULT 'large' CHECK (text_size IN ('large', 'extra-large')),
  high_contrast boolean NOT NULL DEFAULT false,
  message_notifications boolean NOT NULL DEFAULT true,
  quest_notifications boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.sessions (
  session_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON identity.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON identity.sessions(expires_at);

CREATE TABLE IF NOT EXISTS chat.conversations (
  conversation_id text PRIMARY KEY,
  conversation_type text NOT NULL CHECK (conversation_type IN ('direct', 'group')),
  title text,
  image_url text,
  direct_key text UNIQUE,
  created_by text REFERENCES identity.users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (conversation_type = 'group' OR direct_key IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS chat.conversation_members (
  conversation_id text NOT NULL REFERENCES chat.conversations(conversation_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_members_user_idx
  ON chat.conversation_members(user_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS chat.messages (
  message_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES chat.conversations(conversation_id) ON DELETE CASCADE,
  sender_id text REFERENCES identity.users(user_id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz
);
CREATE INDEX IF NOT EXISTS messages_conversation_time_idx
  ON chat.messages(conversation_id, created_at DESC);

