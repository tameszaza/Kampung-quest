import { NextResponse } from "next/server";
import { rewardRedemptionService } from "@/server/container";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

type RouteContext = { params: Promise<{ offerId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { offerId } = await context.params;
    return NextResponse.json(await rewardRedemptionService.getOffer(user.id, offerId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
