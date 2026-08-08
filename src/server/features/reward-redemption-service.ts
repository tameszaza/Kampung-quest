import type {
  RewardEligibility,
  RewardHistoryItem,
  RewardOffer,
  RewardSummary,
  UsableReward,
} from "@/server/features/reward-service";
import {
  RewardDomainError,
  type RewardStore,
  type StoredRewardRedemption,
} from "@/server/repositories/reward-store";

export interface RewardRedemptionView {
  redemptionId: string;
  offerId: string;
  company: string;
  title: string;
  description: string;
  value: string;
  pointsCost: number;
  code: string;
  status: "issued" | "used" | "cancelled";
  redeemedAt: string;
  effectiveExpiresAt: string;
  locations: string;
  terms: string;
}

export interface RewardRedemptionResult {
  redemption: RewardRedemptionView;
  rewards: RewardSummary;
  replayed: boolean;
}

export interface RewardRedemptionServiceDependencies {
  store: RewardStore;
  getBaseSummary: (userId: string) => Promise<RewardSummary>;
  now?: () => Date;
}

export class RewardRedemptionService {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: RewardRedemptionServiceDependencies) {
    this.clock = dependencies.now ?? (() => new Date());
  }

  async getRewards(userId: string, now = this.clock()): Promise<RewardSummary> {
    const [base, account, offers, redemptions] = await Promise.all([
      this.dependencies.getBaseSummary(userId),
      this.dependencies.store.getAccount(userId),
      this.dependencies.store.listOffers(now),
      this.dependencies.store.listRedemptions(userId),
    ]);
    const authoritativeBase = account ? { ...base, balance: account.balance, lifetimePoints: account.lifetimePoints } : base;
    const balance = account ? account.balance : availableBalance(base.balance, redemptions);
    const history = buildHistory(authoritativeBase, redemptions);
    const usableRewards = redemptions
      .filter((redemption) => redemption.status === "issued" && Date.parse(redemption.effectiveExpiresAt) > now.getTime())
      .sort((left, right) => Date.parse(left.effectiveExpiresAt) - Date.parse(right.effectiveExpiresAt)
        || right.redeemedAt.localeCompare(left.redeemedAt))
      .map(toUsableReward);
    const decoratedOffers = await this.decorateOffers(offers, balance, redemptions, now);
    const nextOffer = decoratedOffers
      .filter((offer) => offer.pointsCost > balance && offer.status === "active")
      .sort((left, right) => left.pointsCost - right.pointsCost)[0];

    return {
      ...authoritativeBase,
      balance,
      pointsUntilNextReward: nextOffer ? nextOffer.pointsCost - balance : 0,
      offers: decoratedOffers,
      history,
      usableRewards,
    };
  }

  async getOffer(userId: string, offerId: string, now = this.clock()): Promise<RewardOffer & {
    eligibility: RewardEligibility;
    balance: number;
    balanceAfter: number | null;
  }> {
    const [base, account, offers, redemptions] = await Promise.all([
      this.dependencies.getBaseSummary(userId),
      this.dependencies.store.getAccount(userId),
      this.dependencies.store.listOffers(now),
      this.dependencies.store.listRedemptions(userId),
    ]);
    const offer = offers.find((candidate) => candidate.offerId === offerId);
    if (!offer) throw new RewardDomainError("OFFER_NOT_FOUND", "This reward could not be found.");
    const balance = account ? account.balance : availableBalance(base.balance, redemptions);
    const eligibility = await this.eligibility(offer, balance, redemptions, now);
    return {
      ...offer,
      eligibility,
      balance,
      balanceAfter: eligibility.status === "eligible" ? eligibility.balanceAfter : null,
    };
  }

  async redeem(input: {
    userId: string;
    offerId: string;
    idempotencyKey: string;
    now?: Date;
  }): Promise<RewardRedemptionResult> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw new RewardDomainError("IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required.");
    }
    const now = input.now ?? this.clock();
    const [base, account, offers, existing] = await Promise.all([
      this.dependencies.getBaseSummary(input.userId),
      this.dependencies.store.getAccount(input.userId),
      this.dependencies.store.listOffers(now),
      this.dependencies.store.listRedemptions(input.userId),
    ]);
    const offer = offers.find((candidate) => candidate.offerId === input.offerId);
    if (!offer) throw new RewardDomainError("OFFER_NOT_FOUND", "This reward could not be found.");

    const requestFingerprint = JSON.stringify({ offerId: offer.offerId });
    const replay = existing.find((redemption) => redemption.idempotencyKey === idempotencyKey);
    if (replay) {
      if (replay.requestFingerprint !== requestFingerprint) {
        throw new RewardDomainError(
          "IDEMPOTENCY_KEY_REUSED",
          "This redemption request key was already used for a different offer.",
        );
      }
      return {
        redemption: toRedemptionView(replay),
        rewards: await this.getRewards(input.userId, now),
        replayed: true,
      };
    }

    const balance = account ? account.balance : availableBalance(base.balance, existing);
    const eligibility = await this.eligibility(offer, balance, existing, now);
    throwIfNotEligible(eligibility);

    const redemption = await this.dependencies.store.redeem({
      userId: input.userId,
      offer,
      baseBalance: account?.balance ?? base.balance,
      baseLifetimePoints: account?.lifetimePoints ?? base.lifetimePoints,
      idempotencyKey,
      requestFingerprint,
      now,
    });
    return {
      redemption: toRedemptionView(redemption),
      rewards: await this.getRewards(input.userId, now),
      replayed: false,
    };
  }

  async getRedemption(userId: string, redemptionId: string): Promise<RewardRedemptionView> {
    const redemption = await this.dependencies.store.findRedemption(userId, redemptionId);
    if (!redemption) {
      throw new RewardDomainError("REDEMPTION_NOT_FOUND", "This reward could not be found.");
    }
    return toRedemptionView(redemption);
  }

  private async decorateOffers(
    offers: RewardOffer[],
    balance: number,
    redemptions: StoredRewardRedemption[],
    now: Date,
  ): Promise<RewardOffer[]> {
    return Promise.all(offers.map(async (offer) => ({
      ...offer,
      eligibility: await this.eligibility(offer, balance, redemptions, now),
    })));
  }

  private async eligibility(
    offer: RewardOffer,
    balance: number,
    redemptions: StoredRewardRedemption[],
    now: Date,
  ): Promise<RewardEligibility> {
    if (offer.status === "paused" || offer.status === "retired" || offer.status === "draft") {
      return { status: "paused" };
    }
    if (offer.startsAt && Date.parse(offer.startsAt) > now.getTime()) {
      return { status: "not_started", startsAt: offer.startsAt };
    }
    const expiresAt = offer.validUntilAt ? Date.parse(offer.validUntilAt) : Date.parse(offer.validUntil);
    if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) return { status: "ended" };
    const count = redemptions.filter((redemption) => redemption.offerId === offer.offerId
      && redemption.status !== "cancelled").length;
    if (count >= (offer.maxRedemptionsPerUser ?? 1)) return { status: "limit_reached" };
    if (balance < offer.pointsCost) return { status: "insufficient_points", pointsNeeded: offer.pointsCost - balance };
    if (await this.dependencies.store.countAvailableCodes(offer.offerId, now) < 1) return { status: "out_of_stock" };
    return { status: "eligible", balanceAfter: balance - offer.pointsCost };
  }
}

function throwIfNotEligible(eligibility: RewardEligibility): asserts eligibility is Extract<RewardEligibility, { status: "eligible" }> {
  if (eligibility.status === "eligible") return;
  if (eligibility.status === "insufficient_points") {
    throw new RewardDomainError("INSUFFICIENT_POINTS", `You need ${eligibility.pointsNeeded} more points for this reward.`);
  }
  const messages: Record<Exclude<RewardEligibility["status"], "eligible" | "insufficient_points">, [RewardDomainError["code"], string]> = {
    out_of_stock: ["OFFER_OUT_OF_STOCK", "This reward is currently unavailable."],
    not_started: ["OFFER_NOT_STARTED", "This reward is not available yet."],
    ended: ["OFFER_ENDED", "This reward has ended."],
    paused: ["OFFER_NOT_ACTIVE", "This reward is not currently available."],
    limit_reached: ["REDEMPTION_LIMIT_REACHED", "You have reached this offer's redemption limit."],
  };
  const [code, message] = messages[eligibility.status];
  throw new RewardDomainError(code, message);
}

function availableBalance(baseBalance: number, redemptions: StoredRewardRedemption[]): number {
  return baseBalance - redemptions
    .filter((redemption) => redemption.status !== "cancelled")
    .reduce((total, redemption) => total + redemption.pointsCost, 0);
}

function buildHistory(base: RewardSummary, redemptions: StoredRewardRedemption[]): RewardHistoryItem[] {
  const baseHistory = base.history.length ? base.history : base.earnings.map((earning) => ({
    ...earning,
    kind: earning.points < 0 ? "reversal" as const : "earning" as const,
    subtitle: earning.points < 0 ? "Points adjustment" : earning.difficulty ? `${earning.difficulty} task approved` : "Activity completed",
    occurredAt: earning.earnedAt ?? "",
  }));
  const redemptionHistory = redemptions.map((redemption) => ({
    earningId: `redemption:${redemption.redemptionId}`,
    runId: "",
    title: `${redemption.company} · ${redemption.offerTitle}`,
    points: -redemption.pointsCost,
    earnedAt: redemption.redeemedAt,
    kind: "redemption" as const,
    subtitle: `Points spent · code issued · ${maskCode(redemption.fullCode)}`,
    occurredAt: redemption.redeemedAt,
    redemptionId: redemption.redemptionId,
  }));
  return [...baseHistory, ...redemptionHistory]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

function toUsableReward(redemption: StoredRewardRedemption): UsableReward {
  return {
    redemptionId: redemption.redemptionId,
    offerId: redemption.offerId,
    company: redemption.company,
    title: redemption.offerTitle,
    maskedCode: maskCode(redemption.fullCode),
    pointsCost: redemption.pointsCost,
    status: "issued",
    redeemedAt: redemption.redeemedAt,
    effectiveExpiresAt: redemption.effectiveExpiresAt,
    locations: redemption.locations,
  };
}

function toRedemptionView(redemption: StoredRewardRedemption): RewardRedemptionView {
  return {
    redemptionId: redemption.redemptionId,
    offerId: redemption.offerId,
    company: redemption.company,
    title: redemption.offerTitle,
    description: redemption.description,
    value: redemption.value,
    pointsCost: redemption.pointsCost,
    code: redemption.fullCode,
    status: redemption.status,
    redeemedAt: redemption.redeemedAt,
    effectiveExpiresAt: redemption.effectiveExpiresAt,
    locations: redemption.locations,
    terms: redemption.terms,
  };
}

function maskCode(code: string): string {
  if (code.length <= 4) return "••••";
  return `•••• ${code.slice(-4)}`;
}
