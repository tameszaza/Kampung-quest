const NEXT_PRODUCTION_BUILD_PHASE = "phase-production-build";

/**
 * Next imports server modules while building the standalone bundle. The build
 * must not connect to production services, but the running container must not
 * silently substitute local adapters for missing production configuration.
 */
export function isNextProductionBuild(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return environment.NEXT_PHASE === NEXT_PRODUCTION_BUILD_PHASE;
}

export function isProductionRuntime(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return environment.NODE_ENV === "production" && !isNextProductionBuild(environment);
}

export function assertProductionEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (!isProductionRuntime(environment)) return;

  const missing: string[] = [];
  const required = (name: string) => {
    if (!environment[name]?.trim()) missing.push(name);
  };

  required("DATABASE_URL");
  required("BETTER_AUTH_SECRET");
  required("BETTER_AUTH_URL");
  required("AGENT_PROVIDER");
  required("DEMO_SEED_ENABLED");
  required("AVATAR_STORAGE_DIR");
  required("QUEST_IMAGE_STORAGE_DIR");
  required("REWARD_CODE_ENCRYPTION_KEY");
  required("REWARD_CODE_FINGERPRINT_KEY");

  const provider = environment.AGENT_PROVIDER?.trim();
  if (provider && provider !== "gemini" && provider !== "openai") {
    throw new Error("AGENT_PROVIDER must be exactly gemini or openai in production");
  }
  if (provider === "gemini") required("GEMINI_API_KEY");
  if (provider === "openai") required("OPENAI_API_KEY");

  if (missing.length) {
    throw new Error(`Production configuration is missing: ${missing.join(", ")}`);
  }

  if (environment.DEMO_SEED_ENABLED !== "false") {
    throw new Error("DEMO_SEED_ENABLED must be exactly false in production");
  }

  if ((environment.BETTER_AUTH_SECRET?.length ?? 0) < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters in production");
  }

  const authUrl = new URL(environment.BETTER_AUTH_URL!);
  if (authUrl.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(authUrl.hostname)) {
    throw new Error("BETTER_AUTH_URL must use HTTPS in production");
  }

  const databaseUrl = new URL(environment.DATABASE_URL!);
  if (!(["postgres:", "postgresql:"].includes(databaseUrl.protocol))) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL in production");
  }

  const encryptionKey = environment.REWARD_CODE_ENCRYPTION_KEY!.trim();
  const keyBytes = /^[0-9a-f]{64}$/i.test(encryptionKey)
    ? Buffer.from(encryptionKey, "hex")
    : Buffer.from(encryptionKey, "base64");
  if (keyBytes.length !== 32) {
    throw new Error("REWARD_CODE_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  if (environment.REWARD_CODE_ENCRYPTION_KEY === environment.REWARD_CODE_FINGERPRINT_KEY) {
    throw new Error("REWARD_CODE_FINGERPRINT_KEY must be separate from the encryption key");
  }
  if ((environment.REWARD_CODE_FINGERPRINT_KEY?.length ?? 0) < 32) {
    throw new Error("REWARD_CODE_FINGERPRINT_KEY must be at least 32 characters");
  }
}
