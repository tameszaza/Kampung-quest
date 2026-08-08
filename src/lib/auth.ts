import { Pool } from "pg";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { isValidDisplayName, normalizeUsername } from "@/server/identity/username";
import { assertProductionEnvironment, isNextProductionBuild, isProductionRuntime } from "@/server/runtime-environment";

const globals = globalThis as typeof globalThis & { betterAuthPool?: Pool };

assertProductionEnvironment();

const connectionString = process.env.DATABASE_URL
  ?? (isProductionRuntime() ? null : "postgresql://kampung:kampung_dev_password@127.0.0.1:5432/kampung_quest");

if (!connectionString && !isNextProductionBuild()) {
  throw new Error("DATABASE_URL is required outside the Next production build");
}

export const betterAuthPool = globals.betterAuthPool ?? new Pool({
  connectionString: connectionString ?? "postgresql://build-only-not-used",
  max: 10,
  options: "-c search_path=auth",
});

if (process.env.NODE_ENV !== "production") globals.betterAuthPool = betterAuthPool;

const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const authSecret = process.env.BETTER_AUTH_SECRET
  ?? (isNextProductionBuild() ? "build-only-secret-not-used-at-runtime" : "senior-quest-development-secret-change-me-before-production");

if (!authSecret) throw new Error("BETTER_AUTH_SECRET is required in production");

export const auth = betterAuth({
  appName: "Senior Quest",
  database: betterAuthPool,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: authSecret,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
  },
  socialProviders: googleEnabled ? {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      prompt: "select_account",
    },
  } : {},
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
      allowDifferentEmails: false,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
  },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 40,
      usernameValidator: isValidDisplayName,
      usernameNormalization: (value) => normalizeUsername(value),
      displayUsernameValidator: (value) => value.trim().length >= 3 && value.trim().length <= 40,
      displayUsernameNormalization: (value) => value.trim().replace(/\s+/g, " "),
    }),
  ],
});

export const isGoogleAuthEnabled = googleEnabled;
