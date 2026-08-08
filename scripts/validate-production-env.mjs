const required = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "AGENT_PROVIDER",
  "DEMO_SEED_ENABLED",
  "AVATAR_STORAGE_DIR",
  "QUEST_IMAGE_STORAGE_DIR",
  "REWARD_CODE_ENCRYPTION_KEY",
  "REWARD_CODE_FINGERPRINT_KEY",
];

if (process.env.NODE_ENV !== "production") {
  console.log("Production environment validation skipped: NODE_ENV is not production.");
  process.exit(0);
}

const missing = required.filter((name) => !process.env[name]?.trim());
if (process.env.AGENT_PROVIDER === "gemini" && !process.env.GEMINI_API_KEY?.trim()) {
  missing.push("GEMINI_API_KEY");
}
if (process.env.AGENT_PROVIDER === "openai" && !process.env.OPENAI_API_KEY?.trim()) {
  missing.push("OPENAI_API_KEY");
}

if (missing.length) {
  console.error(`Production configuration is missing: ${[...new Set(missing)].join(", ")}`);
  process.exit(1);
}

if (process.env.AGENT_PROVIDER !== "gemini" && process.env.AGENT_PROVIDER !== "openai") {
  console.error("AGENT_PROVIDER must be exactly gemini or openai in production.");
  process.exit(1);
}
if (process.env.DEMO_SEED_ENABLED !== "false") {
  console.error("DEMO_SEED_ENABLED must be exactly false in production.");
  process.exit(1);
}
if (process.env.BETTER_AUTH_SECRET.length < 32) {
  console.error("BETTER_AUTH_SECRET must be at least 32 characters in production.");
  process.exit(1);
}

try {
  const authUrl = new URL(process.env.BETTER_AUTH_URL);
  if (authUrl.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(authUrl.hostname)) {
    throw new Error("BETTER_AUTH_URL must use HTTPS in production");
  }
  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL in production");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "DATABASE_URL or BETTER_AUTH_URL is invalid");
  process.exit(1);
}

const encryptionKey = process.env.REWARD_CODE_ENCRYPTION_KEY.trim();
const keyBytes = /^[0-9a-f]{64}$/i.test(encryptionKey)
  ? Buffer.from(encryptionKey, "hex")
  : Buffer.from(encryptionKey, "base64");
if (keyBytes.length !== 32) {
  console.error("REWARD_CODE_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  process.exit(1);
}
if (process.env.REWARD_CODE_ENCRYPTION_KEY === process.env.REWARD_CODE_FINGERPRINT_KEY) {
  console.error("REWARD_CODE_FINGERPRINT_KEY must be separate from the encryption key.");
  process.exit(1);
}
if (process.env.REWARD_CODE_FINGERPRINT_KEY.length < 32) {
  console.error("REWARD_CODE_FINGERPRINT_KEY must be at least 32 characters.");
  process.exit(1);
}

console.log("Production environment validation passed.");
