import { describe, expect, it } from "vitest";
import { buildRewardSummary, rewardOffers } from "@/server/features/reward-service";
import { RewardRedemptionService } from "@/server/features/reward-redemption-service";
import { InMemoryRewardStore, RewardDomainError } from "@/server/repositories/reward-store";

function serviceWithBalance(balance: number) {
  const base = { ...buildRewardSummary([]), balance, lifetimePoints: balance };
  const store = new InMemoryRewardStore(rewardOffers);
  return new RewardRedemptionService({
    store,
    getBaseSummary: async () => base,
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  });
}

describe("reward redemption", () => {
  it("spends exactly the offer cost and returns a usable masked code", async () => {
    const service = serviceWithBalance(600);

    const result = await service.redeem({
      userId: "maria",
      offerId: "sunrise-cafe-set",
      idempotencyKey: "redeem-1",
    });

    expect(result.redemption.code).toBe("SC-DEMO-0001");
    expect(result.rewards.balance).toBe(350);
    expect(result.rewards.usableRewards).toEqual([expect.objectContaining({
      redemptionId: result.redemption.redemptionId,
      maskedCode: "•••• 0001",
    })]);
    expect(result.rewards.history).toContainEqual(expect.objectContaining({
      kind: "redemption",
      points: -250,
      subtitle: expect.stringContaining("Points spent · code issued"),
    }));
  });

  it("replays the same redemption for the same idempotency key", async () => {
    const service = serviceWithBalance(600);
    const input = { userId: "maria", offerId: "sunrise-cafe-set", idempotencyKey: "redeem-retry" };

    const first = await service.redeem(input);
    const retry = await service.redeem(input);

    expect(retry.redemption.redemptionId).toBe(first.redemption.redemptionId);
    expect(retry.redemption.code).toBe(first.redemption.code);
    expect(retry.rewards.balance).toBe(350);
  });

  it("rejects a redemption when the member has too few points", async () => {
    const service = serviceWithBalance(249);

    await expect(service.redeem({
      userId: "maria",
      offerId: "sunrise-cafe-set",
      idempotencyKey: "not-enough",
    })).rejects.toMatchObject({ code: "INSUFFICIENT_POINTS" } satisfies Partial<RewardDomainError>);
  });

  it("serializes competing requests so one balance cannot be spent twice", async () => {
    const service = serviceWithBalance(250);
    const results = await Promise.allSettled([
      service.redeem({ userId: "maria", offerId: "sunrise-cafe-set", idempotencyKey: "race-a" }),
      service.redeem({ userId: "maria", offerId: "sunrise-cafe-set", idempotencyKey: "race-b" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")[0]).toMatchObject({
      reason: expect.objectContaining({ code: "INSUFFICIENT_POINTS" }),
    });
  });

  it("does not put the full bearer code in the rewards list", async () => {
    const service = serviceWithBalance(600);
    await service.redeem({ userId: "maria", offerId: "sunrise-cafe-set", idempotencyKey: "redact-code" });

    const rewards = await service.getRewards("maria");
    expect(rewards.usableRewards[0]?.maskedCode).toBe("•••• 0001");
    expect(JSON.stringify(rewards.usableRewards)).not.toContain("SC-DEMO-0001");
  });

  it("uses the durable account balance without subtracting redemptions twice", async () => {
    const store = new InMemoryRewardStore(rewardOffers);
    let balance = 600;
    store.getAccount = async () => ({ balance, lifetimePoints: 600 });
    const redeem = store.redeem.bind(store);
    store.redeem = async (input) => {
      const result = await redeem(input);
      balance -= result.pointsCost;
      return result;
    };
    const service = new RewardRedemptionService({
      store,
      getBaseSummary: async () => ({ ...buildRewardSummary([]), balance: 0, lifetimePoints: 0 }),
      now: () => new Date("2026-08-07T00:00:00.000Z"),
    });

    const result = await service.redeem({
      userId: "durable-account",
      offerId: "sunrise-cafe-set",
      idempotencyKey: "durable-account-1",
    });

    expect(result.rewards.balance).toBe(350);
  });
});
