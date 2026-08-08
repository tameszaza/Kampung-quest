import { notFound } from "next/navigation";
import { RewardOfferDetailPage } from "@/components/reward-offer-detail-page";
import { rewardRedemptionService } from "@/server/container";
import { RewardDomainError } from "@/server/repositories/reward-store";
import { requireUser } from "@/server/identity/session";

export default async function RewardOfferRoute({ params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const user = await requireUser();
  let offer;
  try {
    offer = await rewardRedemptionService.getOffer(user.id, offerId);
  } catch (error) {
    if (error instanceof RewardDomainError && error.code === "OFFER_NOT_FOUND") notFound();
    throw error;
  }
  return <RewardOfferDetailPage initialOffer={offer} />;
}
