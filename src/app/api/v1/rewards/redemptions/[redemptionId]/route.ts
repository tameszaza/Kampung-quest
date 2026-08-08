import { NextResponse } from "next/server";
import { rewardRedemptionService } from "@/server/container";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

type RouteContext = { params: Promise<{ redemptionId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { redemptionId } = await context.params;
    return NextResponse.json(await rewardRedemptionService.getRedemption(user.id, redemptionId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
