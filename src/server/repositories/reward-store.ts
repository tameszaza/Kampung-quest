import { randomUUID } from "node:crypto";
import type { RewardOffer, RewardSummary } from "@/server/features/reward-service";

export type RewardErrorCode =
  | "OFFER_NOT_FOUND"
  | "OFFER_NOT_ACTIVE"
  | "OFFER_CHANGED"
  | "OFFER_NOT_STARTED"
  | "OFFER_ENDED"
  | "OFFER_OUT_OF_STOCK"
  | "REDEMPTION_LIMIT_REACHED"
  | "INSUFFICIENT_POINTS"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "INVALID_REQUEST"
  | "IDEMPOTENCY_KEY_REUSED"
  | "REDEMPTION_NOT_FOUND"
  | "REWARD_CODE_KEY_MISSING";

export class RewardDomainError extends Error {
  readonly code: RewardErrorCode;

  constructor(code: RewardErrorCode, message: string) {
    super(message);
    this.name = "RewardDomainError";
    this.code = code;
  }
}

export type RewardRedemptionStatus = "issued" | "used" | "cancelled";

export interface StoredRewardRedemption {
  redemptionId: string;
  userId: string;
  offerId: string;
  status: RewardRedemptionStatus;
  pointsCost: number;
  offerTitle: string;
  company: string;
  description: string;
  value: string;
  locations: string;
  terms: string;
  effectiveExpiresAt: string;
  redeemedAt: string;
  usedAt: string | null;
  fullCode: string;
  idempotencyKey: string;
  requestFingerprint: string;
}

export interface RewardStore {
  listOffers(now: Date): Promise<RewardOffer[]>;
  countAvailableCodes(offerId: string, now: Date): Promise<number>;
  getAccount(userId: string): Promise<{ balance: number; lifetimePoints: number } | null>;
  getLedgerSummary(userId: string): Promise<RewardSummary | null>;
  listRedemptions(userId: string): Promise<StoredRewardRedemption[]>;
  findRedemption(userId: string, redemptionId: string): Promise<StoredRewardRedemption | null>;
  redeem(input: {
    userId: string;
    offer: RewardOffer;
    baseBalance: number;
    baseLifetimePoints: number;
    idempotencyKey: string;
    requestFingerprint: string;
    now: Date;
  }): Promise<StoredRewardRedemption>;
}

interface InMemoryCode {
  offerId: string;
  value: string;
  claimedBy: string | null;
  expiresAt?: string | null;
}

/**
 * A deterministic, database-free adapter for local development and service
 * tests. Production uses Postgres; these codes are intentionally fake.
 */
export class InMemoryRewardStore implements RewardStore {
  private readonly redemptions = new Map<string, StoredRewardRedemption>();
  private readonly codes: InMemoryCode[];
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly offers: RewardOffer[],
    codes: InMemoryCode[] = InMemoryRewardStore.demoCodes(offers),
  ) {
    this.codes = codes.map((code) => ({ ...code }));
  }

  async listOffers(): Promise<RewardOffer[]> {
    return structuredClone(this.offers.filter((offer) => offer.status !== "retired"));
  }

  async countAvailableCodes(offerId: string, now = new Date()): Promise<number> {
    return this.codes.filter((code) => code.offerId === offerId && !code.claimedBy
      && (!code.expiresAt || Date.parse(code.expiresAt) > now.getTime())).length;
  }

  async getAccount(): Promise<{ balance: number; lifetimePoints: number } | null> {
    // The in-memory adapter deliberately leaves the activity summary as its
    // source of truth; Postgres uses the durable rewards.accounts wallet.
    return null;
  }

  async getLedgerSummary(): Promise<RewardSummary | null> {
    return null;
  }

  async listRedemptions(userId: string): Promise<StoredRewardRedemption[]> {
    return [...this.redemptions.values()]
      .filter((redemption) => redemption.userId === userId)
      .sort((left, right) => right.redeemedAt.localeCompare(left.redeemedAt))
      .map((redemption) => structuredClone(redemption));
  }

  async findRedemption(userId: string, redemptionId: string): Promise<StoredRewardRedemption | null> {
    const redemption = this.redemptions.get(redemptionId);
    if (!redemption || redemption.userId !== userId) return null;
    return structuredClone(redemption);
  }

  async redeem(input: {
    userId: string;
    offer: RewardOffer;
    baseBalance: number;
    baseLifetimePoints: number;
    idempotencyKey: string;
    requestFingerprint: string;
    now: Date;
  }): Promise<StoredRewardRedemption> {
    return this.withLock(input.userId, async () => {
      const currentOffer = this.offers.find((candidate) => candidate.offerId === input.offer.offerId);
      if (!currentOffer || currentOffer.status === "retired") {
        throw new RewardDomainError("OFFER_NOT_FOUND", "This reward could not be found.");
      }
      if (currentOffer.status !== "active") throw new RewardDomainError("OFFER_NOT_ACTIVE", "This reward is not currently available.");
      if (currentOffer.startsAt && Date.parse(currentOffer.startsAt) > input.now.getTime()) {
        throw new RewardDomainError("OFFER_NOT_STARTED", "This reward is not available yet.");
      }
      if (currentOffer.validUntilAt && Date.parse(currentOffer.validUntilAt) <= input.now.getTime()) {
        throw new RewardDomainError("OFFER_ENDED", "This reward has ended.");
      }
      if (currentOffer.pointsCost !== input.offer.pointsCost) {
        throw new RewardDomainError("OFFER_CHANGED", "This reward changed. Refresh and try again.");
      }
      const existing = [...this.redemptions.values()].find((redemption) =>
        redemption.userId === input.userId && redemption.idempotencyKey === input.idempotencyKey);
      if (existing) {
        if (existing.requestFingerprint !== input.requestFingerprint) {
          throw new RewardDomainError(
            "IDEMPOTENCY_KEY_REUSED",
            "This redemption request key was already used for a different offer.",
          );
        }
        return structuredClone(existing);
      }

      const current = await this.listRedemptions(input.userId);
      const spent = current
        .filter((redemption) => redemption.status !== "cancelled")
        .reduce((total, redemption) => total + redemption.pointsCost, 0);
      if (input.baseBalance - spent < currentOffer.pointsCost) {
        throw new RewardDomainError(
          "INSUFFICIENT_POINTS",
          `You need ${currentOffer.pointsCost - Math.max(0, input.baseBalance - spent)} more points for this reward.`,
        );
      }

      const priorCount = current.filter((redemption) => redemption.offerId === currentOffer.offerId
        && redemption.status !== "cancelled").length;
      const limit = currentOffer.maxRedemptionsPerUser ?? 1;
      if (priorCount >= limit) {
        throw new RewardDomainError(
          "REDEMPTION_LIMIT_REACHED",
          "You have reached this offer's redemption limit.",
        );
      }

      const code = this.codes.find((candidate) => candidate.offerId === currentOffer.offerId && !candidate.claimedBy
        && (!candidate.expiresAt || Date.parse(candidate.expiresAt) > input.now.getTime()));
      if (!code) {
        throw new RewardDomainError(
          "OFFER_OUT_OF_STOCK",
          "This reward is currently unavailable.",
        );
      }

      const redemptionId = `redemption_${randomUUID()}`;
      const redeemedAt = input.now.toISOString();
      const effectiveExpiresAt = currentOffer.validUntilAt
        ?? new Date(currentOffer.validUntil).toISOString();
      const redemption: StoredRewardRedemption = {
        redemptionId,
        userId: input.userId,
        offerId: currentOffer.offerId,
        status: "issued",
        pointsCost: currentOffer.pointsCost,
        offerTitle: currentOffer.title,
        company: currentOffer.company,
        description: currentOffer.description,
        value: currentOffer.value,
        locations: currentOffer.locations,
        terms: currentOffer.terms ?? currentOffer.description,
        effectiveExpiresAt,
        redeemedAt,
        usedAt: null,
        fullCode: code.value,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
      };
      code.claimedBy = redemptionId;
      this.redemptions.set(redemptionId, redemption);
      return structuredClone(redemption);
    });
  }

  private async withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(key, current);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }

  private static demoCodes(offers: RewardOffer[]): InMemoryCode[] {
    return offers.flatMap((offer) => Array.from({ length: 25 }, (_, index) => ({
      offerId: offer.offerId,
      value: `${offer.initials}-DEMO-${String(index + 1).padStart(4, "0")}`,
      claimedBy: null,
    })));
  }
}
