import { NextResponse } from "next/server";
import { candidateProfileSchema } from "@/server/domain/schemas";
import { memoryService } from "@/server/container";
import { errorResponse } from "@/server/http/responses";

export async function POST(request: Request) {
  try {
    const profile = candidateProfileSchema.parse(await request.json());
    return NextResponse.json(memoryService.remember(profile), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
