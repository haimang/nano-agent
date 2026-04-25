import type { TraceContext, TraceEvent } from "../traces.js";
import { D1QuotaRepository, type QuotaBalanceRow, type QuotaKind } from "./repository.js";

export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED";

  constructor(
    readonly quotaKind: QuotaKind,
    readonly remaining: number,
    readonly limitValue: number,
    message?: string,
  ) {
    super(
      message ??
        `${quotaKind} quota exhausted (remaining=${remaining}, limit=${limitValue})`,
    );
  }
}

export interface QuotaRuntimeContext {
  readonly teamUuid: string;
  readonly sessionUuid: string;
  readonly traceUuid: string;
  readonly turnUuid?: string | null;
}

export interface QuotaAuthorizationTicket {
  readonly requestId: string;
  readonly quotaKind: QuotaKind;
  readonly remaining: number;
  readonly limitValue: number;
}

export interface QuotaAuthorizerOptions {
  readonly llmLimit: number;
  readonly toolLimit: number;
  readonly emitTrace?: (event: TraceEvent) => Promise<void>;
}

function pickProviderKey(detail: Record<string, unknown>): string | null {
  return typeof detail.provider_key === "string" && detail.provider_key.length > 0
    ? detail.provider_key
    : null;
}

export class QuotaAuthorizer {
  constructor(
    private readonly repo: D1QuotaRepository,
    private readonly options: QuotaAuthorizerOptions,
  ) {}

  async authorize(
    quotaKind: QuotaKind,
    context: QuotaRuntimeContext,
    requestId: string,
    detail: Record<string, unknown>,
  ): Promise<QuotaAuthorizationTicket> {
    const balance = await this.repo.ensureBalance(
      context.teamUuid,
      quotaKind,
      this.defaultLimit(quotaKind),
    );
    if (balance.remaining < 1) {
      await this.repo.recordUsage({
        teamUuid: context.teamUuid,
        sessionUuid: context.sessionUuid,
        traceUuid: context.traceUuid,
        providerKey: pickProviderKey(detail),
        resourceKind: quotaKind,
        verdict: "deny",
        quantity: 0,
        unit: "call",
        idempotencyKey: `${quotaKind}:deny:${requestId}`,
        deductBalance: false,
        defaultLimitValue: balance.limitValue,
      });
      await this.emitTrace({
        eventKind: "quota.deny",
        timestamp: new Date().toISOString(),
        traceUuid: context.traceUuid,
        sessionUuid: context.sessionUuid,
        teamUuid: context.teamUuid,
        turnUuid: context.turnUuid ?? undefined,
        sourceRole: quotaKind === "llm" ? "session" : "capability",
        sourceKey: "nano-agent.quota@v1",
        audience: "internal",
        layer: "durable-audit",
        error: {
          code: "QUOTA_EXCEEDED",
          message: `${quotaKind} quota exhausted`,
        },
      });
      throw new QuotaExceededError(
        quotaKind,
        balance.remaining,
        balance.limitValue,
      );
    }

    return {
      requestId,
      quotaKind,
      remaining: balance.remaining,
      limitValue: balance.limitValue,
    };
  }

  async commit(
    quotaKind: QuotaKind,
    context: QuotaRuntimeContext,
    requestId: string,
    detail: Record<string, unknown>,
  ): Promise<QuotaBalanceRow> {
    const result = await this.repo.recordUsage({
      teamUuid: context.teamUuid,
      sessionUuid: context.sessionUuid,
      traceUuid: context.traceUuid,
      providerKey: pickProviderKey(detail),
      resourceKind: quotaKind,
      verdict: "allow",
      quantity: 1,
      unit: "call",
      idempotencyKey: `${quotaKind}:allow:${requestId}`,
      deductBalance: true,
      defaultLimitValue: this.defaultLimit(quotaKind),
    });
    await this.emitTrace({
      eventKind:
        quotaKind === "llm"
          ? "runtime.llm.invoke"
          : "runtime.tool.invoke",
      timestamp: new Date().toISOString(),
      traceUuid: context.traceUuid,
      sessionUuid: context.sessionUuid,
      teamUuid: context.teamUuid,
      turnUuid: context.turnUuid ?? undefined,
      sourceRole: quotaKind === "llm" ? "session" : "capability",
      sourceKey: "nano-agent.quota@v1",
      audience: "internal",
      layer: "durable-audit",
    });

    return result.balance;
  }

  async inspect(teamUuid: string) {
    return this.repo.readBalances(teamUuid);
  }

  async setBalance(
    teamUuid: string,
    quotaKind: QuotaKind,
    remaining: number,
    limitValue?: number,
  ) {
    return this.repo.setBalance(
      teamUuid,
      quotaKind,
      remaining,
      limitValue ?? this.defaultLimit(quotaKind),
    );
  }

  private defaultLimit(quotaKind: QuotaKind): number {
    return quotaKind === "llm" ? this.options.llmLimit : this.options.toolLimit;
  }

  private async emitTrace(event: TraceEvent): Promise<void> {
    if (this.options.emitTrace) {
      await this.options.emitTrace(event);
    }
  }
}
