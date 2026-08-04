import { NextResponse } from "next/server";
import { z } from "zod";
import { eventCoordinator } from "@/server/container";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

const requestSchema = z.object({ runId: z.string().min(1).optional() });

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const command = requestSchema.parse(await request.json());
    return NextResponse.json({ marked: await eventCoordinator.markNotificationsRead({ actorId: user.id, ...command }) });
  } catch (error) {
    return errorResponse(error);
  }
}
