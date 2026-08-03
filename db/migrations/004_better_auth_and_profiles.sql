CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth."user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  "image" text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "username" text UNIQUE,
  "displayUsername" text
);

CREATE TABLE IF NOT EXISTS auth."session" (
  "id" text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES auth."user"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth."account" (
  "id" text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES auth."user"("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS auth."verification" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "session_userId_idx" ON auth."session"("userId");
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON auth."account"("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON auth."verification"("identifier");

ALTER TABLE identity.users DROP CONSTRAINT IF EXISTS users_check1;
ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx
  ON identity.users (lower(username)) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_contact_search_idx
  ON identity.users (lower(full_name), lower(username));

UPDATE identity.users
SET onboarding_complete = true
WHERE account_type = 'community';

DROP TABLE IF EXISTS identity.sessions;
