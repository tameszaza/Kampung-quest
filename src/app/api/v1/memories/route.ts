import { NextResponse } from "next/server";
import { memoryUpdateRequestSchema } from "@/server/domain/schemas";
import { kampungQuestEngine } from "@/server/container";
import { errorResponse } from "@/server/http/responses";

export async function POST(request: Request) {
  try {
    const command = memoryUpdateRequestSchema.parse(await request.json());
    return NextResponse.json(await kampungQuestEngine.recordMemory(command), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
