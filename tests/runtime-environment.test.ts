import { describe, expect, it } from "vitest";
import { assertProductionEnvironment, isProductionRuntime } from "@/server/runtime-environment";

const validProductionEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:password@db.example.test:5432/app",
  BETTER_AUTH_SECRET: "a".repeat(40),
  BETTER_AUTH_URL: "https://quest.example.test",
  AGENT_PROVIDER: "gemini",
  GEMINI_API_KEY: "gemini-test-key",
  DEMO_SEED_ENABLED: "false",
  AVATAR_STORAGE_DIR: "/app/.data/avatars",
  QUEST_IMAGE_STORAGE_DIR: "/app/.data/quest-images",
  REWARD_CODE_ENCRYPTION_KEY: "0".repeat(64),
  REWARD_CODE_FINGERPRINT_KEY: "fingerprint-test-secret-0123456789",
};

describe("production runtime environment", () => {
  it("does not treat a Next build as a running production service", () => {
    expect(isProductionRuntime({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).toBe(false);
  });

  it("accepts a complete hosted production environment", () => {
    expect(() => assertProductionEnvironment(validProductionEnvironment)).not.toThrow();
  });

  it("rejects missing production infrastructure instead of allowing local adapters", () => {
    expect(() => assertProductionEnvironment({ NODE_ENV: "production" })).toThrow(
      /DATABASE_URL.*BETTER_AUTH_SECRET.*AGENT_PROVIDER/,
    );
  });

  it("rejects demo data in production", () => {
    expect(() => assertProductionEnvironment({
      ...validProductionEnvironment,
      DEMO_SEED_ENABLED: "true",
    })).toThrow("DEMO_SEED_ENABLED must be exactly false");
  });

  it("rejects deterministic agents in production", () => {
    expect(() => assertProductionEnvironment({
      ...validProductionEnvironment,
      AGENT_PROVIDER: "deterministic",
    })).toThrow("AGENT_PROVIDER must be exactly gemini or openai");
  });

  it("rejects non-HTTPS public auth URLs", () => {
    expect(() => assertProductionEnvironment({
      ...validProductionEnvironment,
      BETTER_AUTH_URL: "http://quest.example.test",
    })).toThrow("BETTER_AUTH_URL must use HTTPS");
  });
});
