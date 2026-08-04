import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
import { DeterministicEmbeddingProvider } from "@/server/agents/embedding-provider";
import { KampungQuestEngine } from "@/server/core/kampung-quest-engine";
import { candidateProfileSchema } from "@/server/domain/schemas";
import { InMemoryKampungStore } from "@/server/repositories/kampung-store";
import { createTestCandidateProfile, TEST_USER_PASSWORD, TEST_USER_PERSONAS } from "@/server/testing/test-user-personas";

describe("test user personas", () => {
  it("defines fifteen unique login-capable fixtures in the planned role distribution", () => {
    expect(TEST_USER_PERSONAS).toHaveLength(15);
    expect(new Set(TEST_USER_PERSONAS.map((persona) => persona.fixtureKey)).size).toBe(15);
    expect(new Set(TEST_USER_PERSONAS.map((persona) => persona.email)).size).toBe(15);
    expect(new Set(TEST_USER_PERSONAS.map((persona) => persona.username)).size).toBe(15);
    expect(TEST_USER_PERSONAS.filter((persona) => persona.fixtureRole === "primary")).toHaveLength(9);
    expect(TEST_USER_PERSONAS.filter((persona) => persona.fixtureRole === "hard_filter")).toHaveLength(4);
    expect(TEST_USER_PERSONAS.filter((persona) => persona.fixtureRole === "reserve")).toHaveLength(2);
    expect(TEST_USER_PASSWORD).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/);
  });

  it("creates schema-valid profiles with flexible future Singapore availability", () => {
    const now = new Date("2026-08-04T00:00:00.000Z");
    for (const persona of TEST_USER_PERSONAS) {
      const profile = createTestCandidateProfile(persona, `candidate_${persona.fixtureKey}`, now);
      expect(candidateProfileSchema.parse(profile)).toEqual(profile);
      expect(profile.source).toBe("demo");
      expect(profile.constraints.availableWindows).toHaveLength(persona.fixtureRole === "hard_filter" ? 12 : 84);
      expect(profile.constraints.availableWindows.every((window) => Date.parse(window.start) > now.getTime())).toBe(true);
      expect(profile.constraints.availableWindows.every((window) => window.timeZone === "Asia/Singapore")).toBe(true);
      if (persona.fixtureRole !== "hard_filter") {
        expect(new Set(profile.constraints.availableWindows.map((window) => new Date(window.start).getUTCDay() || 7))).toHaveLength(7);
        expect(profile.constraints.availableWindows.every((window) => window.start.includes("T08:00:00+08:00"))).toBe(true);
        expect(profile.constraints.availableWindows.every((window) => window.end.includes("T20:00:00+08:00"))).toBe(true);
      }
    }
  });

  it("retains representative preferred schedule labels for the three primary cohorts", () => {
    const primarySchedules = new Map<string, Set<string>>();
    for (const persona of TEST_USER_PERSONAS.filter((candidate) => candidate.fixtureRole === "primary")) {
      const schedule = `${persona.schedule.dayOfWeek}:${persona.schedule.startLocalTime}-${persona.schedule.endLocalTime}`;
      const schedules = primarySchedules.get(persona.cohort) ?? new Set<string>();
      schedules.add(schedule);
      primarySchedules.set(persona.cohort, schedules);
    }
    expect([...primarySchedules.values()].every((schedules) => schedules.size === 1)).toBe(true);
    expect(new Set([...primarySchedules.values()].map((schedules) => [...schedules][0])).size).toBe(3);
  });

  it("keeps the intended strong matches and removes each single-rule near-match", async () => {
    const store = new InMemoryKampungStore();
    const engine = new KampungQuestEngine({
      store,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    const now = new Date("2026-08-04T00:00:00.000Z");
    for (const persona of TEST_USER_PERSONAS) {
      await engine.recordMemory({
        profile: createTestCandidateProfile(persona, persona.fixtureKey, now),
        narrative: persona.need,
        providedSoftFacts: { need: true, interests: true, offers: true },
      });
    }

    const cooking = new Set((await engine.retrieveCandidates({ initiatingCandidateId: "cook_host", limit: 15 })).map((item) => item.profile.candidateId));
    const garden = new Set((await engine.retrieveCandidates({ initiatingCandidateId: "garden_host", limit: 15 })).map((item) => item.profile.candidateId));
    const technology = new Set((await engine.retrieveCandidates({ initiatingCandidateId: "tech_host", limit: 15 })).map((item) => item.profile.candidateId));

    expect([...cooking]).toEqual(expect.arrayContaining(["cook_halal", "cook_step_free", "reserve_cooking"]));
    expect([...garden]).toEqual(expect.arrayContaining(["garden_seated", "garden_companion"]));
    expect([...technology]).toEqual(expect.arrayContaining(["tech_errands", "tech_language", "reserve_technology"]));
    expect(cooking.has("filter_time")).toBe(false);
    expect(cooking.has("filter_group")).toBe(false);
    expect(garden.has("filter_distance")).toBe(false);
    expect(technology.has("filter_language")).toBe(false);
  });

  it("classifies every scripted coordination prompt with the deterministic agent", async () => {
    const runtime = new DeterministicAgentRuntime();
    for (const persona of TEST_USER_PERSONAS) {
      const output = await runtime.coordinateEvent({
        quest: { title: "Fixture quest", description: "Fixture coordination", durationMinutes: 60 },
        messages: [],
        currentRequirements: {
          availableWindows: [], accessibility: [], travel: [], dietary: [], environmental: [],
          venuePreferences: [], temporaryConflicts: [], other: [],
        },
        latestMessage: persona.coordinationTestMessage,
      });
      expect(Object.keys(output.requirementPatch).sort(), persona.fixtureKey).toEqual([...persona.expectedCoordinationFields].sort());
      for (const field of persona.expectedCoordinationFields) {
        expect(output.requirementPatch[field], `${persona.fixtureKey}:${field}`).toEqual([persona.coordinationTestMessage]);
      }
    }
  });

  it("keeps the credential CSV synchronized with the persona catalog", () => {
    const csv = readFileSync("test-data/test-users.csv", "utf8");
    const [headers, ...rows] = parseCsv(csv);
    expect(rows).toHaveLength(TEST_USER_PERSONAS.length);
    for (const persona of TEST_USER_PERSONAS) {
      const row = Object.fromEntries(headers.map((header, index) => [header, rows.find((candidate) => candidate[0] === persona.fixtureKey)?.[index]]));
      expect(row).toEqual({
        fixture_key: persona.fixtureKey,
        full_name: persona.fullName,
        username: persona.username,
        email: persona.email,
        password: TEST_USER_PASSWORD,
        cohort: persona.cohort,
        fixture_role: persona.fixtureRole,
        expected_matching_behavior: persona.expectedMatchingBehavior,
        need: persona.need,
        interests: persona.interests.join("; "),
        offers: persona.offers.join("; "),
        availability_sgt: persona.fixtureRole === "hard_filter"
          ? `${dayName(persona.schedule.dayOfWeek)} ${persona.schedule.startLocalTime}-${persona.schedule.endLocalTime}`
          : "Every day 08:00-20:00",
        languages: persona.languages.join("; "),
        maximum_distance_m: String(persona.maximumDistanceM),
        group_size: `${persona.minimumGroupSize}-${persona.maximumGroupSize}`,
        venue_accessibility: `${persona.indoorRequired ? "indoor required" : "indoor or outdoor"}; ${persona.stairsAllowed ? "stairs allowed" : "step-free access required"}`,
        dietary_requirements: persona.dietaryRequirements.join("; "),
        coordination_test_message: persona.coordinationTestMessage,
        expected_deterministic_fields: persona.expectedCoordinationFields.join("; "),
      });
    }
  });
});

function dayName(dayOfWeek: number): string {
  return ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][dayOfWeek];
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
