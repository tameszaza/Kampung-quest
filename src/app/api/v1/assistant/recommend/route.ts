import { NextResponse } from "next/server";
import { assistantRecommendationService } from "@/server/container";
import { assistantRecommendationRequestSchema } from "@/server/domain/schemas";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const command = assistantRecommendationRequestSchema.parse({ ...await request.json(), candidateId: user.id });
    const result = await assistantRecommendationService.recommend(command, undefined, {
      allowDemoNeighbors: user.username === "test",
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
