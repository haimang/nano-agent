import type {
  SessionRuntimePermissionRule,
  SessionRuntimePermissionRuleBehavior,
} from "@haimang/nacp-session";

export interface TeamPermissionRuleRow extends SessionRuntimePermissionRule {
  readonly rule_uuid: string;
  readonly team_uuid: string;
  readonly priority: number;
  readonly created_at: string;
  readonly updated_at: string;
}

function rowToRule(row: Record<string, unknown>): TeamPermissionRuleRow {
  return {
    rule_uuid: String(row.rule_uuid),
    team_uuid: String(row.team_uuid),
    tool_name: String(row.tool_name),
    pattern: typeof row.pattern === "string" && row.pattern.length > 0 ? row.pattern : undefined,
    behavior: String(row.behavior) as SessionRuntimePermissionRuleBehavior,
    scope: "tenant",
    priority: Number(row.priority ?? 100),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export class D1PermissionRulesPlane {
  constructor(private readonly db: D1Database) {}

  async listTeamRules(teamUuid: string): Promise<TeamPermissionRuleRow[]> {
    const rows = await this.db.prepare(
      `SELECT rule_uuid, team_uuid, tool_name, pattern, behavior, priority, created_at, updated_at
         FROM nano_team_permission_rules
        WHERE team_uuid = ?1
        ORDER BY priority ASC, updated_at DESC`,
    ).bind(teamUuid).all<Record<string, unknown>>();
    return (rows.results ?? []).map(rowToRule);
  }

  async upsertTeamRule(input: {
    readonly team_uuid: string;
    readonly tool_name: string;
    readonly pattern?: string | null;
    readonly behavior: SessionRuntimePermissionRuleBehavior;
    readonly priority?: number;
    readonly rule_uuid?: string;
  }): Promise<TeamPermissionRuleRow> {
    const now = new Date().toISOString();
    const ruleUuid = input.rule_uuid ?? crypto.randomUUID();
    await this.db.prepare(
      `INSERT INTO nano_team_permission_rules (
         rule_uuid, team_uuid, tool_name, pattern, behavior, priority, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT(rule_uuid) DO UPDATE SET
         tool_name = excluded.tool_name,
         pattern = excluded.pattern,
         behavior = excluded.behavior,
         priority = excluded.priority,
         updated_at = excluded.updated_at`,
    ).bind(
      ruleUuid,
      input.team_uuid,
      input.tool_name,
      input.pattern ?? null,
      input.behavior,
      input.priority ?? 100,
      now,
    ).run();
    const row = await this.db.prepare(
      `SELECT rule_uuid, team_uuid, tool_name, pattern, behavior, priority, created_at, updated_at
         FROM nano_team_permission_rules
        WHERE rule_uuid = ?1
        LIMIT 1`,
    ).bind(ruleUuid).first<Record<string, unknown>>();
    if (!row) throw new Error("permission rule row lost after upsert");
    return rowToRule(row);
  }
}
