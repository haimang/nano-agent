import { redactPayload } from "@haimang/nacp-session";

export type QuotaKind = "llm" | "tool";
export type UsageVerdict = "allow" | "deny";

export interface QuotaBalanceRow {
  readonly teamUuid: string;
  readonly quotaKind: QuotaKind;
  readonly remaining: number;
  readonly limitValue: number;
  readonly updatedAt: string;
}

export interface UsageEventRecord {
  readonly usageEventUuid: string;
  readonly teamUuid: string;
  readonly sessionUuid: string | null;
  readonly traceUuid: string;
  readonly resourceKind: QuotaKind;
  readonly verdict: UsageVerdict;
  readonly quantity: number;
  readonly unit: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

const MAX_ACTIVITY_PAYLOAD_BYTES = 8 * 1024;
const UNIQUE_RETRY_LIMIT = 3;
const MESSAGE_REDACTION_FIELDS = [
  "access_token",
  "refresh_token",
  "authority",
  "auth_snapshot",
  "password",
  "secret",
  "openid",
  "unionid",
] as const;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /unique/i.test(error.message) &&
    /constraint/i.test(error.message)
  );
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && Number.isFinite(Number(value))
      ? Number(value)
      : 0;
}

function serializeActivityPayload(payload: Record<string, unknown>): string {
  const sanitized = redactPayload(payload, [...MESSAGE_REDACTION_FIELDS]);
  const serialized = JSON.stringify(sanitized);
  const size = new TextEncoder().encode(serialized).byteLength;
  if (size <= MAX_ACTIVITY_PAYLOAD_BYTES) return serialized;
  return JSON.stringify({
    truncated: true,
    original_bytes: size,
    preserved_keys: Object.keys(sanitized).slice(0, 32),
  });
}

export class D1QuotaRepository {
  constructor(private readonly db: D1Database) {}

  private async ensureTeamSeed(teamUuid: string): Promise<void> {
    const now = new Date().toISOString();
    const ownerUserUuid = teamUuid;
    await this.db.batch([
      this.db.prepare(
        `INSERT OR IGNORE INTO nano_users (
           user_uuid,
           user_status,
           default_team_uuid,
           is_email_verified,
           created_at,
           updated_at
         ) VALUES (?1, 'active', ?2, 1, ?3, ?3)`,
      ).bind(ownerUserUuid, teamUuid, now),
      this.db.prepare(
        `INSERT OR IGNORE INTO nano_teams (
           team_uuid,
           owner_user_uuid,
           created_at,
           plan_level
         ) VALUES (?1, ?2, ?3, 0)`,
      ).bind(teamUuid, ownerUserUuid, now),
    ]);
  }

  async ensureBalance(
    teamUuid: string,
    quotaKind: QuotaKind,
    limitValue: number,
  ): Promise<QuotaBalanceRow> {
    const now = new Date().toISOString();
    await this.ensureTeamSeed(teamUuid);
    await this.db.prepare(
      `INSERT OR IGNORE INTO nano_quota_balances (
         team_uuid,
         quota_kind,
         remaining,
         limit_value,
         updated_at
       ) VALUES (?1, ?2, ?3, ?3, ?4)`,
    ).bind(teamUuid, quotaKind, limitValue, now).run();

    const row = await this.db.prepare(
      `SELECT team_uuid, quota_kind, remaining, limit_value, updated_at
         FROM nano_quota_balances
        WHERE team_uuid = ?1
          AND quota_kind = ?2
        LIMIT 1`,
    ).bind(teamUuid, quotaKind).first<Record<string, unknown>>();

    return {
      teamUuid,
      quotaKind,
      remaining: toCount(row?.remaining),
      limitValue: toCount(row?.limit_value) || limitValue,
      updatedAt: typeof row?.updated_at === "string" ? row.updated_at : now,
    };
  }

  async setBalance(
    teamUuid: string,
    quotaKind: QuotaKind,
    remaining: number,
    limitValue: number,
  ): Promise<QuotaBalanceRow> {
    const now = new Date().toISOString();
    await this.db.prepare(
      `INSERT INTO nano_quota_balances (
         team_uuid,
         quota_kind,
         remaining,
         limit_value,
         updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(team_uuid, quota_kind)
       DO UPDATE SET
         remaining = excluded.remaining,
         limit_value = excluded.limit_value,
         updated_at = excluded.updated_at`,
    ).bind(
      teamUuid,
      quotaKind,
      Math.max(0, Math.trunc(remaining)),
      Math.max(0, Math.trunc(limitValue)),
      now,
    ).run();

    return {
      teamUuid,
      quotaKind,
      remaining: Math.max(0, Math.trunc(remaining)),
      limitValue: Math.max(0, Math.trunc(limitValue)),
      updatedAt: now,
    };
  }

  async recordUsage(input: {
    readonly teamUuid: string;
    readonly sessionUuid: string | null;
    readonly traceUuid: string;
    readonly resourceKind: QuotaKind;
    readonly verdict: UsageVerdict;
    readonly quantity: number;
    readonly unit: string;
    readonly idempotencyKey: string;
    readonly deductBalance: boolean;
    readonly defaultLimitValue: number;
  }): Promise<{
    readonly inserted: boolean;
    readonly event: UsageEventRecord;
    readonly balance: QuotaBalanceRow;
  }> {
    const balance = await this.ensureBalance(
      input.teamUuid,
      input.resourceKind,
      input.defaultLimitValue,
    );
    const createdAt = new Date().toISOString();
    const quantity = Math.max(0, Math.trunc(input.quantity));
    const usageEventUuid = crypto.randomUUID();

    const insert = await this.db.prepare(
      `INSERT OR IGNORE INTO nano_usage_events (
         usage_event_uuid,
         team_uuid,
         session_uuid,
         trace_uuid,
         resource_kind,
         verdict,
         quantity,
         unit,
         idempotency_key,
         created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    ).bind(
      usageEventUuid,
      input.teamUuid,
      input.sessionUuid,
      input.traceUuid,
      input.resourceKind,
      input.verdict,
      quantity,
      input.unit,
      input.idempotencyKey,
      createdAt,
    ).run();

    const inserted = (insert.meta.changes ?? 0) > 0;
    if (inserted && input.deductBalance && quantity > 0) {
      await this.db.prepare(
        `UPDATE nano_quota_balances
            SET remaining = CASE
                  WHEN remaining >= ?3 THEN remaining - ?3
                  ELSE 0
                END,
                updated_at = ?4
          WHERE team_uuid = ?1
            AND quota_kind = ?2`,
      ).bind(
        input.teamUuid,
        input.resourceKind,
        quantity,
        createdAt,
      ).run();
    }

    const nextBalance = await this.ensureBalance(
      input.teamUuid,
      input.resourceKind,
      balance.limitValue,
    );

    return {
      inserted,
      event: {
        usageEventUuid,
        teamUuid: input.teamUuid,
        sessionUuid: input.sessionUuid,
        traceUuid: input.traceUuid,
        resourceKind: input.resourceKind,
        verdict: input.verdict,
        quantity,
        unit: input.unit,
        idempotencyKey: input.idempotencyKey,
        createdAt,
      },
      balance: nextBalance,
    };
  }

  async appendActivity(input: {
    readonly teamUuid: string;
    readonly sessionUuid: string | null;
    readonly traceUuid: string;
    readonly turnUuid: string | null;
    readonly eventKind: string;
    readonly severity: "info" | "warn" | "error";
    readonly payload: Record<string, unknown>;
  }): Promise<number> {
    const payloadText = serializeActivityPayload(input.payload);
    const createdAt = new Date().toISOString();
    for (let attempt = 0; attempt < UNIQUE_RETRY_LIMIT; attempt += 1) {
      const activityUuid = crypto.randomUUID();
      try {
        await this.db.prepare(
          `INSERT INTO nano_session_activity_logs (
             activity_uuid,
             team_uuid,
             actor_user_uuid,
             conversation_uuid,
             session_uuid,
             turn_uuid,
             trace_uuid,
             event_seq,
             event_kind,
             severity,
             payload,
             created_at
           )
           SELECT
             ?1,
             ?2,
             NULL,
             NULL,
             ?3,
             ?4,
             ?5,
             COALESCE(MAX(event_seq), 0) + 1,
             ?6,
             ?7,
             ?8,
             ?9
           FROM nano_session_activity_logs
           WHERE trace_uuid = ?5`,
        ).bind(
          activityUuid,
          input.teamUuid,
          input.sessionUuid,
          input.turnUuid,
          input.traceUuid,
          input.eventKind,
          input.severity,
          payloadText,
          createdAt,
        ).run();
        const row = await this.db.prepare(
          `SELECT event_seq
             FROM nano_session_activity_logs
            WHERE activity_uuid = ?1
            LIMIT 1`,
        ).bind(activityUuid).first<Record<string, unknown>>();
        return toCount(row?.event_seq) || 1;
      } catch (error) {
        if (attempt + 1 < UNIQUE_RETRY_LIMIT && isUniqueConstraintError(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("failed to append quota activity after unique retries");
  }

  async readBalances(teamUuid: string): Promise<Record<QuotaKind, QuotaBalanceRow>> {
    const rows = await this.db.prepare(
      `SELECT team_uuid, quota_kind, remaining, limit_value, updated_at
         FROM nano_quota_balances
        WHERE team_uuid = ?1`,
    ).bind(teamUuid).all<Record<string, unknown>>();

    const out = {} as Record<QuotaKind, QuotaBalanceRow>;
    for (const row of rows.results ?? []) {
      const quotaKind = row.quota_kind === "tool" ? "tool" : "llm";
      out[quotaKind] = {
        teamUuid,
        quotaKind,
        remaining: toCount(row.remaining),
        limitValue: toCount(row.limit_value),
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
      };
    }
    return out;
  }
}
