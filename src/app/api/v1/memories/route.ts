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

/** Return the signed-in member's memory without treating an empty profile as an error. */
export async function GET() {
  try {
    const user = await requireUser();
    const memory = await kampungQuestEngine.getMemory(user.id);
    return NextResponse.json({ memory });
  } catch (error) {
    return errorResponse(error);
  }
}
