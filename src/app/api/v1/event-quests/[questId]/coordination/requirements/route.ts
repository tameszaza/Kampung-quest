import { NextResponse } from "next/server";
import { z } from "zod";
import { eventCoordinator } from "@/server/container";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

type RouteContext = { params: Promise<{ questId: string }> };
const requestSchema = z.object({ expectedRevision: z.number().int().positive() });

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { questId } = await context.params;
    const command = requestSchema.parse(await request.json());
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (!idempotencyKey) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 });
    return NextResponse.json(await eventCoordinator.confirmRequirements({
      runId: questId,
      actorId: user.id,
      expectedRevision: command.expectedRevision,
      idempotencyKey,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

