export interface AiPolicy {
  userRequestsPerMinute: number;
  globalRequestsPerMinute: number;
  userDailyBudgetMicros: number;
  globalDailyBudgetMicros: number;
  userConcurrency: number;
  globalConcurrency: number;
  maxInputBytes: number;
  maxOutputTokens: number;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}

export function readAiPolicy(env: Readonly<Record<string, string | undefined>> = process.env): AiPolicy {
  const positive = (key: string, fallback: number, integer = true) => {
    const raw = env[key];
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value))) {
      throw new Error(`${key} must be a positive ${integer ? "integer" : "number"}`);
    }
    return value;
  };
  const dollars = (key: string, fallback: number) => {
    const micros = Math.ceil(positive(key, fallback, false) * 1_000_000);
    if (!Number.isSafeInteger(micros)) throw new Error(`${key} is too large`);
    return micros;
  };
  return {
    userRequestsPerMinute: positive("AI_USER_REQUESTS_PER_MINUTE", 20),
    globalRequestsPerMinute: positive("AI_GLOBAL_REQUESTS_PER_MINUTE", 120),
    userDailyBudgetMicros: dollars("AI_USER_DAILY_BUDGET_USD", 5),
    globalDailyBudgetMicros: dollars("AI_GLOBAL_DAILY_BUDGET_USD", 100),
    userConcurrency: positive("AI_USER_CONCURRENCY", 2),
    globalConcurrency: positive("AI_GLOBAL_CONCURRENCY", 8),
    maxInputBytes: positive("AI_MAX_INPUT_BYTES", 65_536),
    maxOutputTokens: positive("AI_MAX_OUTPUT_TOKENS", 4_096),
    inputUsdPerMillionTokens: positive("AI_INPUT_USD_PER_MILLION_TOKENS", 10, false),
    outputUsdPerMillionTokens: positive("AI_OUTPUT_USD_PER_MILLION_TOKENS", 30, false),
  };
}

export type AiControlCode = "AI_RATE_LIMITED" | "AI_BUDGET_EXHAUSTED" | "AI_BUSY"
  | "AI_GUARD_UNAVAILABLE" | "AI_INPUT_TOO_LARGE" | "AI_REQUEST_UNSUPPORTED" | "AI_AUTH_REQUIRED";

const messages: Record<AiControlCode, string> = {
  AI_RATE_LIMITED: "You have made too many AI requests. Please wait before trying again.",
  AI_BUDGET_EXHAUSTED: "The daily AI allowance has been reached. Please try again after it resets.",
  AI_BUSY: "AI assistance is busy. Please wait before trying again.",
  AI_GUARD_UNAVAILABLE: "AI assistance is temporarily unavailable. Please try again later.",
  AI_INPUT_TOO_LARGE: "This request is too large for AI assistance. Please shorten it and try again.",
  AI_REQUEST_UNSUPPORTED: "This AI request is not supported.",
  AI_AUTH_REQUIRED: "Authentication required for AI assistance.",
};

export class AiControlError extends Error {
  constructor(readonly code: AiControlCode, readonly retryAfter = 0) {
    super(messages[code]);
  }
  get status() {
    if (this.code === "AI_AUTH_REQUIRED") return 401;
    if (this.code === "AI_INPUT_TOO_LARGE") return 413;
    if (this.code === "AI_REQUEST_UNSUPPORTED") return 400;
    if (this.code === "AI_GUARD_UNAVAILABLE") return 503;
    return 429;
  }
}

/** Recover our error after SDKs wrap a local HTTP denial or a transport failure. */
export function findAiControlError(error: unknown): AiControlError | null {
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    if (current instanceof AiControlError) return current;
    const value = current as { code?: unknown; headers?: Headers; cause?: unknown };
    if (typeof value.code === "string" && Object.hasOwn(messages, value.code)) {
      const seconds = Number(value.headers?.get("retry-after") ?? 0);
      return new AiControlError(value.code as AiControlCode, Number.isFinite(seconds) ? seconds : 0);
    }
    current = value.cause;
  }
  return null;
}
