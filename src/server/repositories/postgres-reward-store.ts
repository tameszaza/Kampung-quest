import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  rewardOffers,
  type RewardEarning,
  type RewardOffer,
  type RewardSummary,
} from "@/server/features/reward-service";
import {
  decryptRewardCode,
} from "@/server/security/reward-code-crypto";
import {
  RewardDomainError,
  type RewardStore,
  type StoredRewardRedemption,
} from "@/server/repositories/reward-store";

interface OfferRow {
  offer_id: string;
  company: string;
  title: string;
  description: string;
  category: string;
  value_text: string;
  points_cost: number;
  status: RewardOffer["status"];
  starts_at: Date | string | null;
  ends_at: Date | string;
  max_redemptions_per_user: number;
  locations: string;
  terms: string;
  presentation: Record<string, unknown>;
}

interface RedemptionRow {
  redemption_id: string;
  user_id: string;
  offer_id: string;
  status: StoredRewardRedemption["status"];
  points_cost: number;
  offer_title_snapshot: string;
  company_snapshot: string;
  description_snapshot: string;
  value_snapshot: string;
  locations_snapshot: string;
  terms_snapshot: string;
  effective_expires_at: Date | string;
  redeemed_at: Date | string;
  used_at: Date | string | null;
  encrypted_code: Buffer;
  encryption_key_version: number;
  idempotency_key: string;
  request_fingerprint: string;
}

interface LedgerRow {
  entry_id: string;
  run_id: string | null;
  task_id: string | null;
  points: number;
  kind: "activity_award" | "task_award" | "admin_award" | "reversal";
  created_at: Date | string;
  task_title: string | null;
  event_title: string | null;
  difficulty: RewardEarning["difficulty"] | null;
}

export class PostgresRewardStore implements RewardStore {
  readonly pool: Pool;

  constructor(connectionString: string, pool?: Pool) {
    this.pool = pool ?? new Pool({ connectionString, max: 10 });
  }

  async listOffers(): Promise<RewardOffer[]> {
    const result = await this.pool.query<OfferRow>(
      `SELECT offer_id, company, title, description, category, value_text,
              points_cost, status, starts_at, ends_at, max_redemptions_per_user,
              locations, terms, presentation
         FROM rewards.offers
        WHERE status <> 'retired'
        ORDER BY points_cost ASC, offer_id ASC`,
    );
    return result.rows.map(offerFromRow);
  }

  async countAvailableCodes(offerId: string, now: Date): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM rewards.offer_codes
        WHERE offer_id = $1
          AND status = 'available'
          AND (expires_at IS NULL OR expires_at > $2)`,
      [offerId, now.toISOString()],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async getAccount(userId: string): Promise<{ balance: number; lifetimePoints: number } | null> {
    const result = await this.pool.query<{ balance: number; lifetime_points: number }>(
      "SELECT balance, lifetime_points FROM rewards.accounts WHERE user_id = $1",
      [userId],
    );
    const row = result.rows[0];
    return row ? { balance: Number(row.balance), lifetimePoints: Number(row.lifetime_points) } : null;
  }

  async getLedgerSummary(userId: string): Promise<RewardSummary | null> {
    const [account, ledger] = await Promise.all([
      this.getAccount(userId),
      this.pool.query<LedgerRow>(
        `SELECT l.entry_id, l.run_id, l.task_id, l.points, l.kind, l.created_at,
                task.title AS task_title,
                state.payload->'proposal'->'quest'->>'title' AS event_title,
                task.difficulty
           FROM rewards.point_ledger l
           LEFT JOIN quest.event_tasks task ON task.task_id = l.task_id
           LEFT JOIN quest.event_coordination_states state ON state.run_id = l.run_id
          WHERE l.user_id = $1
            AND l.kind IN ('activity_award', 'task_award', 'admin_award', 'reversal')
          ORDER BY l.created_at DESC, l.entry_id DESC`,
        [userId],
      ),
    ]);
    if (!account && ledger.rows.length === 0) return null;

    const earnings = ledger.rows.map((row) => ({
      earningId: row.entry_id,
      runId: row.run_id ?? "",
      title: row.task_id
        ? `${row.event_title ?? "Event"} · ${row.task_title ?? "Event task"}`
        : row.kind === "admin_award" ? "Points added by Senior Quest" : row.event_title ?? "Completed activity",
      points: Number(row.points),
      taskId: row.task_id ?? undefined,
      difficulty: row.difficulty ?? undefined,
      earnedAt: toIso(row.created_at),
    }));
    const history = earnings.map((earning) => ({
      ...earning,
      kind: earning.points < 0 ? "reversal" as const : "earning" as const,
      subtitle: earning.points < 0
        ? "Points adjustment"
        : ledger.rows.find((row) => row.entry_id === earning.earningId)?.kind === "admin_award"
          ? "Manual points grant"
        : earning.difficulty ? `${earning.difficulty} task approved` : "Activity completed",
      occurredAt: earning.earnedAt ?? "",
    }));
    const balance = account?.balance ?? earnings.reduce((sum, earning) => sum + earning.points, 0);
    const nextOffer = [...rewardOffers]
      .sort((left, right) => left.pointsCost - right.pointsCost)
      .find((offer) => offer.pointsCost > balance);
    return {
      balance,
      lifetimePoints: account?.lifetimePoints ?? earnings.reduce((sum, earning) => sum + earning.points, 0),
      completedActivityCount: ledger.rows.filter((row) => row.kind === "activity_award").length,
      approvedTaskCount: ledger.rows.filter((row) => row.kind === "task_award").length,
      pointsPerCompletedActivity: 100,
      pointsUntilNextReward: nextOffer ? nextOffer.pointsCost - balance : 0,
      earnings,
      offers: rewardOffers,
      history,
      usableRewards: [],
    };
  }

  async listRedemptions(userId: string): Promise<StoredRewardRedemption[]> {
    const result = await this.pool.query<RedemptionRow>(
      `SELECT r.redemption_id, r.user_id, r.offer_id, r.status, r.points_cost,
              r.offer_title_snapshot, r.company_snapshot, r.description_snapshot,
              r.value_snapshot, r.locations_snapshot, r.terms_snapshot,
              r.effective_expires_at, r.redeemed_at, r.used_at,
              c.encrypted_code, c.encryption_key_version, r.idempotency_key, r.request_fingerprint
         FROM rewards.redemptions r
         JOIN rewards.offer_codes c ON c.code_id = r.code_id
        WHERE r.user_id = $1
        ORDER BY r.redeemed_at DESC`,
      [userId],
    );
    return result.rows.map(redemptionFromRow);
  }

  async findRedemption(userId: string, redemptionId: string): Promise<StoredRewardRedemption | null> {
    const result = await this.pool.query<RedemptionRow>(
      `SELECT r.redemption_id, r.user_id, r.offer_id, r.status, r.points_cost,
              r.offer_title_snapshot, r.company_snapshot, r.description_snapshot,
              r.value_snapshot, r.locations_snapshot, r.terms_snapshot,
              r.effective_expires_at, r.redeemed_at, r.used_at,
              c.encrypted_code, c.encryption_key_version, r.idempotency_key, r.request_fingerprint
         FROM rewards.redemptions r
         JOIN rewards.offer_codes c ON c.code_id = r.code_id
        WHERE r.user_id = $1 AND r.redemption_id = $2`,
      [userId, redemptionId],
    );
    return result.rows[0] ? redemptionFromRow(result.rows[0]) : null;
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
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.userId]);

      const existing = await this.findRedemptionByKey(client, input.userId, input.idempotencyKey);
      if (existing) {
        if (existing.request_fingerprint !== input.requestFingerprint) {
          throw new RewardDomainError(
            "IDEMPOTENCY_KEY_REUSED",
            "This redemption request key was already used for a different offer.",
          );
        }
        await client.query("COMMIT");
        return redemptionFromRow(existing);
      }

      await client.query(
        `INSERT INTO rewards.accounts (user_id, balance, lifetime_points, version, created_at, updated_at)
         VALUES ($1, $2, $3, 1, $4, $4)
         ON CONFLICT (user_id) DO NOTHING`,
        [input.userId, input.baseBalance, input.baseLifetimePoints, input.now.toISOString()],
      );
      const account = await client.query<{ balance: number }>(
        "SELECT balance FROM rewards.accounts WHERE user_id = $1 FOR UPDATE",
        [input.userId],
      );
      const balance = Number(account.rows[0]?.balance ?? 0);

      const lockedOffer = await client.query<OfferRow>(
        `SELECT offer_id, company, title, description, category, value_text,
                points_cost, status, starts_at, ends_at, max_redemptions_per_user,
                locations, terms, presentation
           FROM rewards.offers
          WHERE offer_id = $1
          FOR UPDATE`,
        [input.offer.offerId],
      );
      if (!lockedOffer.rows[0]) throw new RewardDomainError("OFFER_NOT_FOUND", "This reward could not be found.");
      const currentOffer = offerFromRow(lockedOffer.rows[0]);
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
      if (balance < currentOffer.pointsCost) {
        throw new RewardDomainError("INSUFFICIENT_POINTS", `You need ${currentOffer.pointsCost - balance} more points for this reward.`);
      }

      const prior = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM rewards.redemptions
          WHERE user_id = $1 AND offer_id = $2 AND status <> 'cancelled'`,
        [input.userId, currentOffer.offerId],
      );
      if (Number(prior.rows[0]?.count ?? 0) >= (currentOffer.maxRedemptionsPerUser ?? 1)) {
        throw new RewardDomainError("REDEMPTION_LIMIT_REACHED", "You have reached this offer's redemption limit.");
      }

      const code = await client.query<{
        code_id: string;
        expires_at: Date | string | null;
      }>(
        `SELECT code_id, expires_at
           FROM rewards.offer_codes
          WHERE offer_id = $1
            AND status = 'available'
            AND (expires_at IS NULL OR expires_at > $2)
          ORDER BY created_at ASC, code_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
        [currentOffer.offerId, input.now.toISOString()],
      );
      if (!code.rows[0]) throw new RewardDomainError("OFFER_OUT_OF_STOCK", "This reward is currently unavailable.");

      const effectiveExpiry = earliestExpiry(currentOffer.validUntilAt ?? currentOffer.validUntil, code.rows[0].expires_at);
      let fullCode: string;
      try {
        const ciphertext = await client.query<{ encrypted_code: Buffer; encryption_key_version: number }>(
          "SELECT encrypted_code, encryption_key_version FROM rewards.offer_codes WHERE code_id = $1",
          [code.rows[0].code_id],
        );
        fullCode = decryptRewardCode(ciphertext.rows[0].encrypted_code, Number(ciphertext.rows[0].encryption_key_version));
      } catch {
        throw new RewardDomainError("REWARD_CODE_KEY_MISSING", "Reward codes are temporarily unavailable.");
      }
      const redemptionId = `redemption_${randomUUID()}`;
      const redeemedAt = input.now.toISOString();
      await client.query(
        `INSERT INTO rewards.redemptions
          (redemption_id, user_id, offer_id, code_id, status, points_cost,
           offer_title_snapshot, company_snapshot, description_snapshot, value_snapshot,
           locations_snapshot, terms_snapshot, effective_expires_at, idempotency_key,
           request_fingerprint, redeemed_at, updated_at)
         VALUES ($1, $2, $3, $4, 'issued', $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16)`,
        [redemptionId, input.userId, currentOffer.offerId, code.rows[0].code_id, currentOffer.pointsCost,
          currentOffer.title, currentOffer.company, currentOffer.description, currentOffer.value,
          currentOffer.locations, currentOffer.terms ?? currentOffer.description, effectiveExpiry,
          input.idempotencyKey, input.requestFingerprint, redeemedAt, redeemedAt],
      );
      await client.query(
        `UPDATE rewards.offer_codes
            SET status = 'issued', updated_at = $2
          WHERE code_id = $1`,
        [code.rows[0].code_id, redeemedAt],
      );
      await client.query(
        `INSERT INTO rewards.point_ledger
          (entry_id, user_id, run_id, task_id, redemption_id, points, kind,
           source_type, source_id, reverses_entry_id, actor_id, reason, metadata, created_at)
         VALUES ($1, $2, NULL, NULL, $3, $4, 'redemption_debit', 'redemption', $3,
                 NULL, $2, 'Reward redemption', '{}'::jsonb, $5)`,
        [`reward_debit_${redemptionId}`, input.userId, redemptionId, -currentOffer.pointsCost, redeemedAt],
      );
      const updated = await client.query(
        `UPDATE rewards.accounts
            SET balance = balance - $2, version = version + 1, updated_at = $3
          WHERE user_id = $1 AND balance >= $2`,
        [input.userId, currentOffer.pointsCost, redeemedAt],
      );
      if (updated.rowCount !== 1) throw new RewardDomainError("INSUFFICIENT_POINTS", "Your points balance changed. Please try again.");
      await client.query("COMMIT");

      return {
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
        effectiveExpiresAt: effectiveExpiry,
        redeemedAt,
        usedAt: null,
        fullCode,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async findRedemptionByKey(client: PoolClient, userId: string, idempotencyKey: string) {
    const result = await client.query<RedemptionRow>(
      `SELECT r.redemption_id, r.user_id, r.offer_id, r.status, r.points_cost,
              r.offer_title_snapshot, r.company_snapshot, r.description_snapshot,
              r.value_snapshot, r.locations_snapshot, r.terms_snapshot,
              r.effective_expires_at, r.redeemed_at, r.used_at,
              c.encrypted_code, c.encryption_key_version, r.idempotency_key, r.request_fingerprint
         FROM rewards.redemptions r
         JOIN rewards.offer_codes c ON c.code_id = r.code_id
        WHERE r.user_id = $1 AND r.idempotency_key = $2
        FOR UPDATE`,
      [userId, idempotencyKey],
    );
    return result.rows[0] ?? null;
  }
}

function offerFromRow(row: OfferRow): RewardOffer {
  const presentation = row.presentation ?? {};
  return {
    ...rewardOffers.find((candidate) => candidate.offerId === row.offer_id),
    offerId: row.offer_id,
    company: row.company,
    title: row.title,
    description: row.description,
    pointsCost: Number(row.points_cost),
    category: row.category,
    initials: typeof presentation.initials === "string" ? presentation.initials : row.company.slice(0, 2).toUpperCase(),
    tone: isTone(presentation.tone) ? presentation.tone : "mint",
    value: row.value_text,
    validUntil: formatDate(row.ends_at),
    validUntilAt: toIso(row.ends_at),
    startsAt: row.starts_at ? toIso(row.starts_at) : undefined,
    status: row.status,
    maxRedemptionsPerUser: Number(row.max_redemptions_per_user),
    locations: row.locations,
    terms: row.terms,
    partnerDescription: typeof presentation.partnerDescription === "string" ? presentation.partnerDescription : row.description,
    redemptionSteps: Array.isArray(presentation.redemptionSteps)
      ? presentation.redemptionSteps.filter((step): step is string => typeof step === "string")
      : ["Choose this reward when you have enough points.", "Show the code to the participating partner."],
    heroImage: stringValue(presentation.heroImage),
    partnerLogoImage: stringValue(presentation.partnerLogoImage),
    outletImage: stringValue(presentation.outletImage),
    rewardBadgeImage: stringValue(presentation.rewardBadgeImage),
    partnerBadgeImage: stringValue(presentation.partnerBadgeImage),
    menuImages: Array.isArray(presentation.menuImages)
      ? presentation.menuImages.filter((image): image is string => typeof image === "string")
      : undefined,
  };
}

function redemptionFromRow(row: RedemptionRow): StoredRewardRedemption {
  let fullCode: string;
  try {
    fullCode = decryptRewardCode(row.encrypted_code, Number(row.encryption_key_version));
  } catch {
    throw new RewardDomainError("REWARD_CODE_KEY_MISSING", "Reward codes are temporarily unavailable.");
  }
  return {
    redemptionId: row.redemption_id,
    userId: row.user_id,
    offerId: row.offer_id,
    status: row.status,
    pointsCost: Number(row.points_cost),
    offerTitle: row.offer_title_snapshot,
    company: row.company_snapshot,
    description: row.description_snapshot,
    value: row.value_snapshot,
    locations: row.locations_snapshot,
    terms: row.terms_snapshot,
    effectiveExpiresAt: toIso(row.effective_expires_at),
    redeemedAt: toIso(row.redeemed_at),
    usedAt: row.used_at ? toIso(row.used_at) : null,
    fullCode,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
  };
}

function earliestExpiry(offerExpiry: string, codeExpiry: Date | string | null): string {
  const offer = new Date(offerExpiry).toISOString();
  if (!codeExpiry) return offer;
  const code = toIso(codeExpiry);
  return Date.parse(code) < Date.parse(offer) ? code : offer;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function formatDate(value: Date | string): string {
  return new Intl.DateTimeFormat("en-SG", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Singapore" }).format(new Date(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isTone(value: unknown): value is RewardOffer["tone"] {
  return value === "mint" || value === "amber" || value === "blue" || value === "rose" || value === "violet" || value === "green";
}
