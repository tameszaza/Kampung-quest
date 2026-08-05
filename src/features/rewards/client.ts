import type { RewardSummary } from "@/server/features/reward-service";

export async function getRewardSummary(): Promise<RewardSummary> {
  const response = await fetch("/api/v1/rewards", { cache: "no-store" });
  const payload = await response.json() as RewardSummary & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Rewards could not be loaded");
  return payload;
}
