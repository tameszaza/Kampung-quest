import { NextResponse } from "next/server";
import { kampungQuestEngine } from "@/server/container";
import { boundedLimit, errorResponse } from "@/server/http/responses";

interface RouteContext {
  params: Promise<{ candidateId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { candidateId } = await context.params;
    const limit = boundedLimit(new URL(request.url).searchParams.get("candidateLimit"));
    const result = await kampungQuestEngine.proposeQuest({
      initiatingCandidateId: candidateId,
      candidateLimit: limit,
      idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
