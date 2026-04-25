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
  readonly providerKey: string | null;
  readonly resourceKind: QuotaKind;
  readonly verdict: UsageVerdict;
  readonly quantity: number;
  readonly unit: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface D1QuotaRepositoryOptions {
  readonly allowSeedMissingTeam?: boolean;
}

const PREVIEW_SEED_OWNER_USER_UUID = "00000000-0000-4000-8000-000000000001";

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && Number.isFinite(Number(value))
      ? Number(value)
      : 0;
}

function toUsageEventRecord(row: Record<string, unknown> | null): UsageEventRecord | null {
  if (!row) return null;
  return {
    usageEventUuid: typeof row.usage_event_uuid === "string" ? row.usage_event_uuid : "",
    teamUuid: typeof row.team_uuid === "string" ? row.team_uuid : "",
    sessionUuid: typeof row.session_uuid === "string" ? row.session_uuid : null,
    traceUuid: typeof row.trace_uuid === "string" ? row.trace_uuid : "",
    providerKey: typeof row.provider_key === "string" ? row.provider_key : null,
    resourceKind: row.resource_kind === "tool" ? "tool" : "llm",
    verdict: row.verdict === "deny" ? "deny" : "allow",
    quantity: toCount(row.quantity),
    unit: typeof row.unit === "string" ? row.unit : "call",
    idempotencyKey: typeof row.idempotency_key === "string" ? row.idempotency_key : "",
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

export class D1QuotaRepository {
  constructor(
    private readonly db: D1Database,
    private readonly options: D1QuotaRepositoryOptions = {},
  ) {}

  private async ensureTeamSeed(teamUuid: string): Promise<void> {
    if (!this.options.allowSeedMissingTeam) return;
    const now = new Date().toISOString();
    const ownerUserUuid = PREVIEW_SEED_OWNER_USER_UUID;
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
    await this.ensureTeamSeed(teamUuid);
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
    readonly providerKey?: string | null;
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
    const providerKey =
      typeof input.providerKey === "string" && input.providerKey.length > 0
        ? input.providerKey
        : null;

    const [insertResult, _updateResult, balanceResult] = await this.db.batch([
      this.db.prepare(
        `INSERT OR IGNORE INTO nano_usage_events (
           usage_event_uuid,
           team_uuid,
           session_uuid,
           trace_uuid,
           provider_key,
           resource_kind,
           verdict,
           quantity,
           unit,
           idempotency_key,
           created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      ).bind(
        usageEventUuid,
        input.teamUuid,
        input.sessionUuid,
        input.traceUuid,
        providerKey,
        input.resourceKind,
        input.verdict,
        quantity,
        input.unit,
        input.idempotencyKey,
        createdAt,
      ),
      this.db.prepare(
        `UPDATE nano_quota_balances
            SET remaining = CASE
                  WHEN remaining >= ?3 THEN remaining - ?3
                  ELSE 0
                END,
                updated_at = ?4
          WHERE team_uuid = ?1
            AND quota_kind = ?2
            AND ?5 = 1
            AND ?3 > 0
            AND EXISTS (
              SELECT 1
                FROM nano_usage_events
               WHERE usage_event_uuid = ?6
            )`,
      ).bind(
        input.teamUuid,
        input.resourceKind,
        quantity,
        createdAt,
        input.deductBalance ? 1 : 0,
        usageEventUuid,
      ),
      this.db.prepare(
        `SELECT team_uuid, quota_kind, remaining, limit_value, updated_at
           FROM nano_quota_balances
          WHERE team_uuid = ?1
            AND quota_kind = ?2
          LIMIT 1`,
      ).bind(input.teamUuid, input.resourceKind),
    ]);

    const inserted = ((insertResult as D1Result).meta?.changes ?? 0) > 0;
    const nextBalanceRow = (balanceResult as D1Result<Record<string, unknown>>).results?.[0];
    const nextBalance: QuotaBalanceRow = {
      teamUuid: input.teamUuid,
      quotaKind: input.resourceKind,
      remaining: toCount(nextBalanceRow?.remaining),
      limitValue: toCount(nextBalanceRow?.limit_value) || balance.limitValue,
      updatedAt:
        typeof nextBalanceRow?.updated_at === "string" ? nextBalanceRow.updated_at : createdAt,
    };

    const event =
      inserted
        ? ({
            usageEventUuid,
            teamUuid: input.teamUuid,
            sessionUuid: input.sessionUuid,
            traceUuid: input.traceUuid,
            providerKey,
            resourceKind: input.resourceKind,
            verdict: input.verdict,
            quantity,
            unit: input.unit,
            idempotencyKey: input.idempotencyKey,
            createdAt,
          } satisfies UsageEventRecord)
        : (toUsageEventRecord(
            await this.db.prepare(
              `SELECT usage_event_uuid, team_uuid, session_uuid, trace_uuid, provider_key,
                      resource_kind, verdict, quantity, unit, idempotency_key, created_at
                 FROM nano_usage_events
                WHERE idempotency_key = ?1
                LIMIT 1`,
            ).bind(input.idempotencyKey).first<Record<string, unknown>>(),
          ) ??
          {
            usageEventUuid,
            teamUuid: input.teamUuid,
            sessionUuid: input.sessionUuid,
            traceUuid: input.traceUuid,
            providerKey,
            resourceKind: input.resourceKind,
            verdict: input.verdict,
            quantity,
            unit: input.unit,
            idempotencyKey: input.idempotencyKey,
            createdAt,
          });

    return {
      inserted,
      event,
      balance: nextBalance,
    };
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
