import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid request", issues: error.issues },
      { status: 400 },
    );
  }
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const status = message.includes("not found")
    ? 404
    : message.includes("provider unavailable")
      ? 503
      : message.includes("conflict") || message.includes("not valid")
        ? 409
        : 422;
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
