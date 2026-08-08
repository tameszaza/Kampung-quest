import type { RewardSummary } from "@/server/features/reward-service";
import type {
  RewardRedemptionResult,
  RewardRedemptionView,
} from "@/server/features/reward-redemption-service";

export async function getRewardSummary(): Promise<RewardSummary> {
  const response = await fetch("/api/v1/rewards", { cache: "no-store" });
  const payload = await response.json() as RewardSummary & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Rewards could not be loaded");
  return payload;
}

export async function getRewardOffer(offerId: string) {
  const response = await fetch(`/api/v1/rewards/offers/${encodeURIComponent(offerId)}`, { cache: "no-store" });
  const payload = await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Reward could not be loaded");
  return payload;
}

export async function redeemReward(offerId: string, idempotencyKey: string): Promise<RewardRedemptionResult> {
  const response = await fetch("/api/v1/rewards", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ offerId }),
  });
  const payload = await response.json() as RewardRedemptionResult & { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(payload.error ?? "Reward could not be redeemed");
    Object.assign(error, { code: payload.code });
    throw error;
  }
  return payload;
}

export async function getRewardRedemption(redemptionId: string): Promise<RewardRedemptionView> {
  const response = await fetch(`/api/v1/rewards/redemptions/${encodeURIComponent(redemptionId)}`, { cache: "no-store" });
  const payload = await response.json() as RewardRedemptionView & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Reward code could not be loaded");
  return payload;
}
