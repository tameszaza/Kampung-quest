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
  const status = message.includes("not found") ? 404 : 422;
  return NextResponse.json({ error: message }, { status });
}

export function boundedLimit(value: string | null, fallback = 15): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(20, Math.max(1, parsed)) : fallback;
}
