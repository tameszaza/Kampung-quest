import { NextResponse } from "next/server";
import { assistantRecommendationService } from "@/server/container";
import { assistantRecommendationRequestSchema } from "@/server/domain/schemas";
import { errorResponse } from "@/server/http/responses";

export async function POST(request: Request) {
  try {
    const command = assistantRecommendationRequestSchema.parse(await request.json());
    const result = await assistantRecommendationService.recommend(command);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
