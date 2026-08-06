import { NextResponse } from "next/server";
import { rewardRedemptionService } from "@/server/container";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";
import { RewardDomainError } from "@/server/repositories/reward-store";
import { z } from "zod";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await rewardRedemptionService.getRewards(user.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleRewardRedemptionPost(request: Request) {
  try {
    const user = await requireUser();
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (!idempotencyKey) throw new RewardDomainError("IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required.");
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      throw new RewardDomainError("INVALID_REQUEST", "Request body must be valid JSON.");
    }
    const body = z.object({ offerId: z.string().trim().min(1).max(120) }).parse(payload);
    const result = await rewardRedemptionService.redeem({
      userId: user.id,
      offerId: body.offerId,
      idempotencyKey,
    });
    return NextResponse.json(result, {
      status: result.replayed ? 200 : 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  return handleRewardRedemptionPost(request);
}
