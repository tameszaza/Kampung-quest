import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { RewardDomainError } from "@/server/repositories/reward-store";
import { findAiControlError } from "@/server/security/ai-policy";

function isPostgresError(error: unknown): error is Error & { code: string } {
  return error instanceof Error
    && "code" in error
    && typeof error.code === "string"
    && /^[0-9A-Z]{5}$/.test(error.code);
}

export function errorResponse(error: unknown): NextResponse {
  const aiError = findAiControlError(error);
  if (aiError) return NextResponse.json({ error: aiError.message, code: aiError.code }, {
    status: aiError.status,
    headers: aiError.retryAfter ? { "Retry-After": String(aiError.retryAfter) } : undefined,
  });
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid request", issues: error.issues },
      { status: 400 },
    );
  }
  if (isPostgresError(error)) {
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
  if (error instanceof RewardDomainError) {
    const status = error.code === "OFFER_NOT_FOUND" || error.code === "REDEMPTION_NOT_FOUND"
      ? 404
      : error.code === "IDEMPOTENCY_KEY_REQUIRED" || error.code === "INVALID_REQUEST"
        ? 400
        : error.code === "REWARD_CODE_KEY_MISSING"
          ? 503
        : 409;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const providerUnavailable = message.includes("provider unavailable")
    || message.startsWith("Gemini request quota")
    || message.startsWith("Gemini's daily request quota");
  const publicMessage = providerUnavailable
    ? "Senior Quest is temporarily unavailable. Your request was not applied—please try again."
    : message;
  const status = message.includes("Authentication required")
    ? 401
    : message.includes("not found")
        ? 404
        : message.startsWith("Only the ")
          || message.includes("not allowed")
          || message.includes("another participant's")
          || message.includes("only to your own")
          ? 403
        : message.includes("already exists")
          ? 409
          : providerUnavailable
            ? 503
            : message.includes("conflict") || message.includes("not valid")
              ? 409
              : 422;
  return NextResponse.json({ error: publicMessage }, { status });
}

export function boundedLimit(value: string | null, fallback = configuredCandidateLimit()): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(fallback, Math.max(1, parsed)) : fallback;
}

function configuredCandidateLimit(): number {
  const configured = Number.parseInt(process.env.APP_MAX_CANDIDATES ?? "15", 10);
  return Number.isFinite(configured) ? Math.min(20, Math.max(1, configured)) : 15;
}
