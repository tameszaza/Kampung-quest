import { NextResponse } from "next/server";
import { assistantConversationService } from "@/server/container";
import { assistantConversationCreateRequestSchema } from "@/server/domain/schemas";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const command = assistantConversationCreateRequestSchema.parse({ ...body, candidateId: user.id });
    return NextResponse.json(await assistantConversationService.create(command), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
