import { NextResponse } from "next/server";
import { memoryUpdateRequestSchema } from "@/server/domain/schemas";
import { kampungQuestEngine } from "@/server/container";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const command = memoryUpdateRequestSchema.parse({ ...await request.json(), candidateId: user.id });
    return NextResponse.json(await kampungQuestEngine.recordMemory(command), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
