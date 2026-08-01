import { NextResponse } from "next/server";
import { questPipeline } from "@/server/container";
import { boundedLimit, errorResponse } from "@/server/http/responses";

interface RouteContext {
  params: Promise<{ candidateId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { candidateId } = await context.params;
    const limit = boundedLimit(new URL(request.url).searchParams.get("candidateLimit"));
    return NextResponse.json(questPipeline.run(candidateId, limit));
  } catch (error) {
    return errorResponse(error);
  }
}
