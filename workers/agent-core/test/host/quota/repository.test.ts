import { describe, expect, it } from "vitest";
import { D1QuotaRepository } from "../../../src/host/quota/repository.js";

class FakePreparedStatement {
  public params: unknown[] = [];

  constructor(
    private readonly db: FakeQuotaDb,
    public readonly sql: string,
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  run() {
    return this.db.run(this.sql, this.params);
  }

  first<T>() {
    return this.db.first<T>(this.sql, this.params);
  }

  all<T>() {
    return this.db.all<T>(this.sql, this.params);
  }
}

class FakeQuotaDb {
  public readonly batchCalls: FakePreparedStatement[][] = [];

  prepare(sql: string) {
    return new FakePreparedStatement(this, sql);
  }

  async batch(statements: FakePreparedStatement[]) {
    this.batchCalls.push(statements);
    if (
      statements.length === 2 &&
      statements[0]?.sql.includes("INSERT OR IGNORE INTO nano_users") &&
      statements[1]?.sql.includes("INSERT OR IGNORE INTO nano_teams")
    ) {
      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
    }
    return [
      { meta: { changes: 1 } },
      { meta: { changes: 1 } },
      {
        results: [
          {
            team_uuid: "team-1",
            quota_kind: "llm",
            remaining: 9,
            limit_value: 10,
            updated_at: "2026-04-25T00:00:00.000Z",
          },
        ],
      },
    ];
  }

  async run(sql: string, _params: unknown[]) {
    if (sql.includes("INSERT OR IGNORE INTO nano_quota_balances")) {
      return { meta: { changes: 1 } };
    }
    if (sql.includes("INSERT INTO nano_quota_balances")) {
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 0 } };
  }

  async first<T>(sql: string, _params: unknown[]) {
    if (sql.includes("FROM nano_quota_balances")) {
      return {
        team_uuid: "team-1",
        quota_kind: "llm",
        remaining: 10,
        limit_value: 10,
        updated_at: "2026-04-25T00:00:00.000Z",
      } as T;
    }
    if (sql.includes("FROM nano_usage_events")) {
      return {
        usage_event_uuid: "usage-1",
        team_uuid: "team-1",
        session_uuid: "session-1",
        trace_uuid: "trace-1",
        provider_key: "workers-ai",
        resource_kind: "llm",
        verdict: "allow",
        quantity: 1,
        unit: "call",
        idempotency_key: "llm:allow:req-1",
        created_at: "2026-04-25T00:00:00.000Z",
      } as T;
    }
    return null as T;
  }

  async all<T>(_sql: string, _params: unknown[]) {
    return { results: [] as T[] };
  }
}

describe("D1QuotaRepository", () => {
  it("records usage in one transactional batch and persists provider_key lineage", async () => {
    const db = new FakeQuotaDb();
    const repo = new D1QuotaRepository(db as unknown as D1Database);

    const result = await repo.recordUsage({
      teamUuid: "team-1",
      sessionUuid: "session-1",
      traceUuid: "trace-1",
      providerKey: "workers-ai",
      resourceKind: "llm",
      verdict: "allow",
      quantity: 1,
      unit: "call",
      idempotencyKey: "llm:allow:req-1",
      deductBalance: true,
      defaultLimitValue: 10,
    });

    expect(db.batchCalls).toHaveLength(1);
    const [insert, update] = db.batchCalls[0];
    expect(insert.sql).toContain("provider_key");
    expect(update.sql).toContain("EXISTS");
    expect(result.event.providerKey).toBe("workers-ai");
    expect(result.balance.remaining).toBe(9);
  });

  it("only seeds missing teams when the explicit preview escape hatch is enabled", async () => {
    const db = new FakeQuotaDb();
    const repo = new D1QuotaRepository(db as unknown as D1Database, {
      allowSeedMissingTeam: true,
    });

    await repo.ensureBalance("team-1", "llm", 10);

    expect(db.batchCalls).toHaveLength(1);
    expect(db.batchCalls[0]?.[0]?.sql).toContain("INSERT OR IGNORE INTO nano_users");
    expect(db.batchCalls[0]?.[1]?.sql).toContain("INSERT OR IGNORE INTO nano_teams");
  });
});
