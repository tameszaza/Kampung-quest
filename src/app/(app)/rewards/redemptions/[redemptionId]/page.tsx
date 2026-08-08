import { notFound } from "next/navigation";
import { RewardCodePage } from "@/components/reward-code-page";
import { rewardRedemptionService } from "@/server/container";
import { RewardDomainError } from "@/server/repositories/reward-store";
import { requireUser } from "@/server/identity/session";

export default async function RewardCodeRoute({ params }: { params: Promise<{ redemptionId: string }> }) {
  const { redemptionId } = await params;
  const user = await requireUser();
  let redemption;
  try {
    redemption = await rewardRedemptionService.getRedemption(user.id, redemptionId);
  } catch (error) {
    if (error instanceof RewardDomainError && error.code === "REDEMPTION_NOT_FOUND") notFound();
    throw error;
  }
  return <RewardCodePage redemption={redemption} />;
}
