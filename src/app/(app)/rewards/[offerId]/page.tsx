import { notFound } from "next/navigation";
import { RewardOfferDetailPage } from "@/components/reward-offer-detail-page";
import { rewardOffers } from "@/server/features/reward-service";

export default async function RewardOfferRoute({ params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const offer = rewardOffers.find((candidate) => candidate.offerId === offerId);
  if (!offer) notFound();
  return <RewardOfferDetailPage offer={offer} />;
}
