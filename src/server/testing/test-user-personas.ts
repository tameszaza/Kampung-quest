import type { CoordinationRequirements } from "@/server/domain/event-coordination";
import type { CandidateProfile, WeeklyAvailabilityRule } from "@/server/domain/schemas";

export const TEST_USER_PASSWORD = "KampungQuest15!";

export type TestFixtureRole = "primary" | "hard_filter" | "reserve";
export type ExpectedCoordinationField = Exclude<keyof CoordinationRequirements, "availableWindows">;

export interface TestUserPersona {
  fixtureKey: string;
  fullName: string;
  username: string;
  email: string;
  dateOfBirth: string;
  gender: string;
  area: string;
  cohort: "healthy_cooking" | "garden_wellbeing" | "technology_help";
  fixtureRole: TestFixtureRole;
  expectedMatchingBehavior: string;
  need: string;
  interests: string[];
  offers: string[];
  schedule: { dayOfWeek: number; startLocalTime: string; endLocalTime: string };
  maximumDistanceM: number;
  minimumGroupSize: number;
  maximumGroupSize: number;
  indoorRequired: boolean;
  stairsAllowed: boolean;
  dietaryRequirements: string[];
  languages: string[];
  distanceFromInitiatorM: number;
  previousGroupScore: number;
  activityLevel: "gentle" | "moderate" | "any";
  accessibilityNeeds: string[];
  coordinationTestMessage: string;
  expectedCoordinationFields: ExpectedCoordinationField[];
}

const account = (local: string) => ({ username: `sqtest.${local}`, email: `sqtest.${local}@example.com` });

export const TEST_USER_PERSONAS: readonly TestUserPersona[] = [
  {
    fixtureKey: "cook_host", fullName: "Alice Tan", ...account("cook.host"), dateOfBirth: "1953-03-14", gender: "Female", area: "Toa Payoh",
    cohort: "healthy_cooking", fixtureRole: "primary", expectedMatchingBehavior: "Cooking cohort initiator; should match Siti and Grace.",
    need: "Would like neighbours to join a healthy lunch cooking session", interests: ["healthy cooking", "community lunches", "low-sodium food"], offers: ["can teach a simple low-sodium soup recipe"],
    schedule: { dayOfWeek: 2, startLocalTime: "10:00", endLocalTime: "12:00" }, maximumDistanceM: 1_500, minimumGroupSize: 2, maximumGroupSize: 3,
    indoorRequired: true, stairsAllowed: true, dietaryRequirements: ["low sodium"], languages: ["English", "Chinese"], distanceFromInitiatorM: 0, previousGroupScore: 0.88,
    activityLevel: "gentle", accessibilityNeeds: [], coordinationTestMessage: "I prefer the community centre kitchen as the venue.", expectedCoordinationFields: ["venuePreferences"],
  },
  {
    fixtureKey: "cook_halal", fullName: "Siti Rahman", ...account("cook.halal"), dateOfBirth: "1957-08-21", gender: "Female", area: "Toa Payoh",
    cohort: "healthy_cooking", fixtureRole: "primary", expectedMatchingBehavior: "Strong cooking match with overlapping availability and halal needs.",
    need: "Would enjoy preparing a healthy halal lunch with nearby neighbours", interests: ["healthy cooking", "halal food", "community lunches"], offers: ["can demonstrate safe halal food preparation"],
    schedule: { dayOfWeek: 2, startLocalTime: "10:00", endLocalTime: "12:00" }, maximumDistanceM: 1_200, minimumGroupSize: 2, maximumGroupSize: 3,
    indoorRequired: true, stairsAllowed: true, dietaryRequirements: ["halal"], languages: ["English", "Malay"], distanceFromInitiatorM: 450, previousGroupScore: 0.84,
    activityLevel: "gentle", accessibilityNeeds: [], coordinationTestMessage: "I need all shared ingredients to be halal.", expectedCoordinationFields: ["dietary"],
  },
  {
    fixtureKey: "cook_step_free", fullName: "Grace Lee", ...account("cook.access"), dateOfBirth: "1950-11-02", gender: "Female", area: "Toa Payoh",
    cohort: "healthy_cooking", fixtureRole: "primary", expectedMatchingBehavior: "Strong cooking match that adds a step-free venue requirement.",
    need: "Would like a small friendly group for vegetarian meal preparation", interests: ["healthy cooking", "vegetarian food", "recipe sharing"], offers: ["can prepare an easy vegetable dish"],
    schedule: { dayOfWeek: 2, startLocalTime: "10:00", endLocalTime: "12:00" }, maximumDistanceM: 1_000, minimumGroupSize: 2, maximumGroupSize: 3,
    indoorRequired: true, stairsAllowed: false, dietaryRequirements: ["vegetarian"], languages: ["English", "Chinese"], distanceFromInitiatorM: 700, previousGroupScore: 0.8,
    activityLevel: "gentle", accessibilityNeeds: ["step-free access"], coordinationTestMessage: "I use a walking aid and need step-free access with no stairs.", expectedCoordinationFields: ["accessibility", "travel"],
  },
  {
    fixtureKey: "garden_host", fullName: "Gopal Nair", ...account("garden.host"), dateOfBirth: "1955-01-09", gender: "Male", area: "Bishan",
    cohort: "garden_wellbeing", fixtureRole: "primary", expectedMatchingBehavior: "Garden cohort initiator; should match Noor and David.",
    need: "Would like neighbours to exchange container gardening tips", interests: ["gardening", "herbs", "gentle outdoor activity"], offers: ["can share herb seedlings and potting tips"],
    schedule: { dayOfWeek: 3, startLocalTime: "08:30", endLocalTime: "10:30" }, maximumDistanceM: 1_500, minimumGroupSize: 2, maximumGroupSize: 3,
    indoorRequired: false, stairsAllowed: true, dietaryRequirements: [], languages: ["English", "Tamil"], distanceFromInitiatorM: 0, previousGroupScore: 0.87,
    activityLevel: "moderate", accessibilityNeeds: [], coordinationTestMessage: "I would like the activity at the park near the community garden.", expectedCoordinationFields: ["venuePreferences"],
  },
  {
    fixtureKey: "garden_seated", fullName: "Noor Aziz", ...account("garden.seated"), dateOfBirth: "1949-06-17", gender: "Female", area: "Bishan",
    cohort: "garden_wellbeing", fixtureRole: "primary", expectedMatchingBehavior: "Strong wellbeing match that requires seating and step-free access.",
    need: "Would enjoy seated stretching and caring for herbs with neighbours", interests: ["gardening", "seated stretching", "wellbeing"], offers: ["can guide a short seated stretching routine"],
    schedule: { dayOfWeek: 3, startLocalTime: "08:30", endLocalTime: "10:30" }, maximumDistanceM: 900, minimumGroupSize: 2, maximumGroupSize: 3,
    indoorRequired: false, stairsAllowed: false, dietaryRequirements: [], languages: ["English", "Malay"], distanceFromInitiatorM: 500, previousGroupScore: 0.82,
    activityLevel: "gentle", accessibilityNeeds: ["step-free access", "chair with back support"], coordinationTestMessage: "I use a walking aid, so the route and venue must be accessible and step-free.", expectedCoordinationFields: ["accessibility", "travel", "venuePreferences"],
  },
  {
    fixtureKey: "garden_companion", fullName: "David Koh", ...account("garden.walk"), dateOfBirth: "1958-04-25", gender: "Male", area: "Bishan",
    cohort: "garden_wellbeing", fixtureRole: "primary", expectedMatchingBehavior: "Strong gardening and companionship match.",
    need: "Would like friendly company for a gentle garden walk", interests: ["gardening", "conversation", "neighbourhood walks"], offers: ["can help carry light gardening materials"],
    schedule: { dayOfWeek: 3, startLocalTime: "08:30", endLocalTime: "10:30" }, maximumDistanceM: 1_500, minimumGroupSize: 2, maximumGroupSize: 3,
    indoorRequired: false, stairsAllowed: true, dietaryRequirements: [], languages: ["English", "Chinese"], distanceFromInitiatorM: 850, previousGroupScore: 0.78,
    activityLevel: "moderate", accessibilityNeeds: [], coordinationTestMessage: "I cannot attend before 9:00 because I have a clinic conflict.", expectedCoordinationFields: ["temporaryConflicts"],
  },
  {
    fixtureKey: "tech_host", fullName: "John Lim", ...account("tech.host"), dateOfBirth: "1954-09-12", gender: "Male", area: "Clementi",
    cohort: "technology_help", fixtureRole: "primary", expectedMatchingBehavior: "Technology cohort initiator; should match Helen and Farah.",
    need: "Would like a small group to practise smartphone and QR payment skills", interests: ["smartphones", "QR payments", "technology learning"], offers: ["can explain phone settings patiently"],
    schedule: { dayOfWeek: 5, startLocalTime: "14:00", endLocalTime: "16:00" }, maximumDistanceM: 1_800, minimumGroupSize: 2, maximumGroupSize: 3,
    indoorRequired: true, stairsAllowed: true, dietaryRequirements: [], languages: ["English"], distanceFromInitiatorM: 0, previousGroupScore: 0.9,
    activityLevel: "gentle", accessibilityNeeds: [], coordinationTestMessage: "The library would be a good quiet venue for practising on our phones.", expectedCoordinationFields: ["venuePreferences"],
  },
  {
    fixtureKey: "tech_errands", fullName: "Helen Wong", ...account("tech.errands"), dateOfBirth: "1951-12-30", gender: "Female", area: "Clementi",
    cohort: "technology_help", fixtureRole: "primary", expectedMatchingBehavior: "Strong phone-help match with a short travel limit.",
    need: "Would like help using maps and cashless payment for nearby errands", interests: ["smartphones", "nearby errands", "QR payments"], offers: ["can share a checklist for planning simple errands"],
    schedule: { dayOfWeek: 5, startLocalTime: "14:00", endLocalTime: "16:00" }, maximumDistanceM: 800, minimumGroupSize: 2, maximumGroupSize: 3,
    indoorRequired: true, stairsAllowed: false, dietaryRequirements: [], languages: ["English", "Chinese"], distanceFromInitiatorM: 550, previousGroupScore: 0.83,
    activityLevel: "gentle", accessibilityNeeds: ["step-free access"], coordinationTestMessage: "I can only travel a short distance and need a direct bus to the venue.", expectedCoordinationFields: ["travel", "venuePreferences"],
  },
  {
    fixtureKey: "tech_language", fullName: "Farah Ismail", ...account("tech.language"), dateOfBirth: "1959-05-08", gender: "Female", area: "Clementi",
    cohort: "technology_help", fixtureRole: "primary", expectedMatchingBehavior: "Strong technology match who can support plain-language explanations.",
    need: "Would like friendly practice with video calls and messaging apps", interests: ["smartphones", "video calls", "language practice"], offers: ["can explain instructions in simple English"],
    schedule: { dayOfWeek: 5, startLocalTime: "14:00", endLocalTime: "16:00" }, maximumDistanceM: 1_400, minimumGroupSize: 2, maximumGroupSize: 3,
    indoorRequired: true, stairsAllowed: true, dietaryRequirements: [], languages: ["English", "Malay"], distanceFromInitiatorM: 900, previousGroupScore: 0.79,
    activityLevel: "gentle", accessibilityNeeds: [], coordinationTestMessage: "I need a quiet environment because loud places make it hard to hear.", expectedCoordinationFields: ["other"],
  },
  {
    fixtureKey: "filter_time", fullName: "Maria Santos", ...account("filter.time"), dateOfBirth: "1956-02-19", gender: "Female", area: "Toa Payoh",
    cohort: "healthy_cooking", fixtureRole: "hard_filter", expectedMatchingBehavior: "Must not match Alice because there is no 30-minute availability overlap.",
    need: "Would enjoy joining neighbours for healthy lunch preparation", interests: ["healthy cooking", "community lunches", "recipes"], offers: ["can prepare a fruit dessert"],
    schedule: { dayOfWeek: 4, startLocalTime: "20:30", endLocalTime: "22:30" }, maximumDistanceM: 1_500, minimumGroupSize: 2, maximumGroupSize: 3,
    indoorRequired: true, stairsAllowed: true, dietaryRequirements: [], languages: ["English"], distanceFromInitiatorM: 600, previousGroupScore: 0.86,
    activityLevel: "gentle", accessibilityNeeds: [], coordinationTestMessage: "I am vegetarian and cannot attend on Tuesday; I can only attend after 20:30.", expectedCoordinationFields: ["dietary", "temporaryConflicts"],
  },
  {
    fixtureKey: "filter_language", fullName: "Li Wei", ...account("filter.language"), dateOfBirth: "1952-07-07", gender: "Male", area: "Clementi",
    cohort: "technology_help", fixtureRole: "hard_filter", expectedMatchingBehavior: "Must not match John because they share no listed language.",
    need: "Would like help practising smartphone and QR payment skills", interests: ["smartphones", "QR payments", "technology learning"], offers: ["can demonstrate a Chinese-language messaging app"],
    schedule: { dayOfWeek: 5, startLocalTime: "14:00", endLocalTime: "16:00" }, maximumDistanceM: 1_800, minimumGroupSize: 2, maximumGroupSize: 3,
    indoorRequired: true, stairsAllowed: true, dietaryRequirements: [], languages: ["Chinese"], distanceFromInitiatorM: 650, previousGroupScore: 0.86,
    activityLevel: "gentle", accessibilityNeeds: [], coordinationTestMessage: "I prefer the library venue and need instructions in Chinese.", expectedCoordinationFields: ["venuePreferences"],
  },
  {
    fixtureKey: "filter_distance", fullName: "Ravi Menon", ...account("filter.distance"), dateOfBirth: "1954-10-16", gender: "Male", area: "Jurong West",
    cohort: "garden_wellbeing", fixtureRole: "hard_filter", expectedMatchingBehavior: "Must not match Gopal because the stored distance exceeds both travel limits.",
    need: "Would like neighbours to exchange herb gardening tips", interests: ["gardening", "herbs", "gentle outdoor activity"], offers: ["can share curry leaf cuttings"],
    schedule: { dayOfWeek: 3, startLocalTime: "08:30", endLocalTime: "10:30" }, maximumDistanceM: 1_000, minimumGroupSize: 2, maximumGroupSize: 3,
    indoorRequired: false, stairsAllowed: true, dietaryRequirements: [], languages: ["English", "Tamil"], distanceFromInitiatorM: 5_000, previousGroupScore: 0.85,
    activityLevel: "moderate", accessibilityNeeds: [], coordinationTestMessage: "I cannot travel more than one kilometre and would need a taxi.", expectedCoordinationFields: ["travel", "temporaryConflicts"],
  },
  {
    fixtureKey: "filter_group", fullName: "Sofia Pereira", ...account("filter.group"), dateOfBirth: "1958-03-23", gender: "Female", area: "Toa Payoh",
    cohort: "healthy_cooking", fixtureRole: "hard_filter", expectedMatchingBehavior: "Must not match Alice because Sofia requires at least four people while Alice allows at most three.",
    need: "Would like a lively group cooking and recipe exchange", interests: ["healthy cooking", "community lunches", "recipe sharing"], offers: ["can coordinate ingredients for a larger group"],
    schedule: { dayOfWeek: 2, startLocalTime: "10:00", endLocalTime: "12:00" }, maximumDistanceM: 1_500, minimumGroupSize: 4, maximumGroupSize: 5,
    indoorRequired: true, stairsAllowed: true, dietaryRequirements: [], languages: ["English"], distanceFromInitiatorM: 500, previousGroupScore: 0.89,
    activityLevel: "moderate", accessibilityNeeds: [], coordinationTestMessage: "I only feel comfortable when at least four people attend.", expectedCoordinationFields: ["other"],
  },
  {
    fixtureKey: "reserve_cooking", fullName: "Anne Chua", ...account("reserve.cook"), dateOfBirth: "1951-05-29", gender: "Female", area: "Toa Payoh",
    cohort: "healthy_cooking", fixtureRole: "reserve", expectedMatchingBehavior: "Eligible lower-ranked cooking reserve for decline or withdrawal recovery.",
    need: "Would like friendly conversation over a simple shared meal", interests: ["conversation", "community connection", "simple meals"], offers: ["can welcome newcomers and set the table"],
    schedule: { dayOfWeek: 2, startLocalTime: "10:00", endLocalTime: "12:00" }, maximumDistanceM: 1_500, minimumGroupSize: 2, maximumGroupSize: 3,
    indoorRequired: true, stairsAllowed: true, dietaryRequirements: [], languages: ["English", "Chinese"], distanceFromInitiatorM: 950, previousGroupScore: 0.25,
    activityLevel: "gentle", accessibilityNeeds: [], coordinationTestMessage: "I am vegetarian and prefer the community centre venue.", expectedCoordinationFields: ["dietary", "venuePreferences"],
  },
  {
    fixtureKey: "reserve_technology", fullName: "Kumar Das", ...account("reserve.tech"), dateOfBirth: "1956-11-11", gender: "Male", area: "Clementi",
    cohort: "technology_help", fixtureRole: "reserve", expectedMatchingBehavior: "Eligible lower-ranked technology reserve for replacement testing.",
    need: "Would enjoy meeting neighbours and learning something useful", interests: ["community connection", "learning", "music"], offers: ["can bring a small speaker and help welcome participants"],
    schedule: { dayOfWeek: 5, startLocalTime: "14:00", endLocalTime: "16:00" }, maximumDistanceM: 1_800, minimumGroupSize: 2, maximumGroupSize: 3,
    indoorRequired: true, stairsAllowed: true, dietaryRequirements: [], languages: ["English", "Tamil"], distanceFromInitiatorM: 1_100, previousGroupScore: 0.2,
    activityLevel: "gentle", accessibilityNeeds: [], coordinationTestMessage: "I need a direct bus route and prefer the library venue.", expectedCoordinationFields: ["travel", "venuePreferences"],
  },
] as const;

export function createTestCandidateProfile(persona: TestUserPersona, candidateId: string, now = new Date()): CandidateProfile {
  const schedules = schedulesForPersona(persona);
  const availableWindows = futureWeeklyWindows(schedules, now);
  const recurringAvailabilityRules: WeeklyAvailabilityRule[] = schedules.map((schedule) => ({
    kind: "weekly_recurrence",
    daysOfWeek: [schedule.dayOfWeek],
    startLocalTime: schedule.startLocalTime,
    endLocalTime: schedule.endLocalTime,
    timeZone: "Asia/Singapore",
    validFrom: availableWindows[0].start.slice(0, 10),
    validUntil: availableWindows.at(-1)!.end.slice(0, 10),
  }));
  return {
    candidateId, source: "demo", need: persona.need, interests: [...persona.interests], offers: [...persona.offers],
    constraints: {
      availableWindows, recurringAvailabilityRules, maximumDistanceM: persona.maximumDistanceM,
      minimumGroupSize: persona.minimumGroupSize, maximumGroupSize: persona.maximumGroupSize,
      indoorRequired: persona.indoorRequired, stairsAllowed: persona.stairsAllowed,
      dietaryRequirements: [...persona.dietaryRequirements], languages: [...persona.languages], verified: true, invitationConsent: true,
    },
    memoryStatus: "active", alreadyCommitted: false, relationshipBlocked: false,
    distanceFromInitiatorM: persona.distanceFromInitiatorM, previousGroupScore: persona.previousGroupScore,
  };
}

export function refreshTestCandidateAvailability(
  persona: TestUserPersona,
  current: CandidateProfile,
  now = new Date(),
): CandidateProfile {
  const refreshed = createTestCandidateProfile(persona, current.candidateId, now);
  return {
    ...structuredClone(current),
    constraints: {
      ...structuredClone(current.constraints),
      availableWindows: refreshed.constraints.availableWindows,
      recurringAvailabilityRules: refreshed.constraints.recurringAvailabilityRules,
    },
  };
}

export function createTestPersonaNarrative(persona: TestUserPersona): string {
  const requirements = [
    persona.indoorRequired ? "indoor venue required" : "indoor or outdoor venue",
    persona.stairsAllowed ? "stairs are acceptable" : "step-free access required",
    persona.dietaryRequirements.length ? `dietary: ${persona.dietaryRequirements.join(", ")}` : "no dietary requirements",
    `languages: ${persona.languages.join(", ")}`,
  ].join("; ");
  return `${persona.need}. ${persona.offers[0]}. Stable requirements: ${requirements}.`;
}

function schedulesForPersona(persona: TestUserPersona): TestUserPersona["schedule"][] {
  if (persona.fixtureRole === "hard_filter") return [persona.schedule];
  return Array.from({ length: 7 }, (_, index) => ({
    dayOfWeek: index + 1,
    startLocalTime: "08:00",
    endLocalTime: "20:00",
  }));
}

function futureWeeklyWindows(schedules: TestUserPersona["schedule"][], now: Date): CandidateProfile["constraints"]["availableWindows"] {
  const singaporeNow = new Date(now.getTime() + 8 * 60 * 60_000);
  const firstDate = new Date(Date.UTC(singaporeNow.getUTCFullYear(), singaporeNow.getUTCMonth(), singaporeNow.getUTCDate() + 1));
  const windows: CandidateProfile["constraints"]["availableWindows"] = [];
  for (let dayOffset = 0; dayOffset < 84; dayOffset += 1) {
    const date = new Date(firstDate.getTime() + dayOffset * 24 * 60 * 60_000);
    const dayOfWeek = date.getUTCDay() || 7;
    for (const schedule of schedules.filter((candidate) => candidate.dayOfWeek === dayOfWeek)) {
      const localDate = date.toISOString().slice(0, 10);
      windows.push({
        start: `${localDate}T${schedule.startLocalTime}:00+08:00`,
        end: `${localDate}T${schedule.endLocalTime}:00+08:00`,
        timeZone: "Asia/Singapore",
      });
    }
  }
  return windows;
}
