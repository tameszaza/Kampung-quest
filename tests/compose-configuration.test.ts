import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Docker Compose provider configuration", () => {
  it("loads the Gemini key from the project dotenv file instead of an inherited shell override", () => {
    const compose = readFileSync("compose.yaml", "utf8");

    expect(compose).toContain("env_file:");
    expect(compose).not.toContain("GEMINI_API_KEY: ${GEMINI_API_KEY");
  });
});
