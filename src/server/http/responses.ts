import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "@/server/observability/logger";

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    logger.warn("http.request.rejected", {
      category: "validation",
      issueCount: error.issues.length,
      status: 400,
    });
    return NextResponse.json(
      { error: "Invalid request", issues: error.issues },
      { status: 400 },
    );
  }
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const status = message.includes("Authentication required")
    ? 401
    : message.includes("request quota") && message.includes("exhausted")
      ? 429
      : message.includes("not found")
        ? 404
        : message.startsWith("Only the ")
          || message.includes("not allowed")
          || message.includes("another participant's")
          || message.includes("only to your own")
          ? 403
        : message.includes("already exists")
          ? 409
          : message.includes("provider unavailable")
            ? 503
            : message.includes("conflict") || message.includes("not valid")
              ? 409
              : 422;
  logger.warn("http.request.failed", {
    category: status >= 500 ? "server" : "application",
    status,
    errorType: error instanceof Error ? error.name : "unknown",
  });
  return NextResponse.json({ error: message }, { status });
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
