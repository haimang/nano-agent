import type { SessionApprovalPolicy, SessionRuntimePermissionRule } from "@haimang/nacp-session";

export interface RuntimeConfigRow {
  readonly session_uuid: string;
  readonly team_uuid: string;
  readonly permission_rules: SessionRuntimePermissionRule[];
  readonly network_policy: { readonly mode: string };
  readonly web_search: { readonly mode: string };
  readonly workspace_scope: { readonly mounts: string[] };
  readonly approval_policy: SessionApprovalPolicy;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

function parseArray(raw: unknown): SessionRuntimePermissionRule[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as SessionRuntimePermissionRule[] : [];
  } catch {
    return [];
  }
}

function parseWorkspaceScope(raw: unknown): { mounts: string[] } {
  if (typeof raw !== "string") return { mounts: [] };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { mounts: [] };
    const mounts = (parsed as { mounts?: unknown }).mounts;
    return { mounts: Array.isArray(mounts) ? mounts.filter((m): m is string => typeof m === "string") : [] };
  } catch {
    return { mounts: [] };
  }
}

function rowToRuntimeConfig(row: Record<string, unknown>): RuntimeConfigRow {
  return {
    session_uuid: String(row.session_uuid),
    team_uuid: String(row.team_uuid),
    permission_rules: parseArray(row.permission_rules_json),
    network_policy: { mode: String(row.network_policy_mode ?? "restricted") },
    web_search: { mode: String(row.web_search_mode ?? "disabled") },
    workspace_scope: parseWorkspaceScope(row.workspace_scope_json),
    approval_policy: String(row.approval_policy ?? "ask") as SessionApprovalPolicy,
    version: Number(row.version ?? 1),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export class D1RuntimeConfigPlane {
  constructor(private readonly db: D1Database) {}

  async readOrCreate(input: {
    readonly session_uuid: string;
    readonly team_uuid: string;
  }): Promise<RuntimeConfigRow> {
    const existing = await this.read(input.session_uuid);
    if (existing) return existing;
    const now = new Date().toISOString();
    await this.db.prepare(
      `INSERT OR IGNORE INTO nano_session_runtime_config (
         session_uuid, team_uuid, permission_rules_json, network_policy_mode,
         web_search_mode, workspace_scope_json, approval_policy, version,
         created_at, updated_at
       ) VALUES (?1, ?2, '[]', 'restricted', 'disabled', '{"mounts":[]}', 'ask', 1, ?3, ?3)`,
    ).bind(input.session_uuid, input.team_uuid, now).run();
    const created = await this.read(input.session_uuid);
    if (!created) throw new Error("runtime config row lost after insert");
    return created;
  }

  async read(sessionUuid: string): Promise<RuntimeConfigRow | null> {
    const row = await this.db.prepare(
      `SELECT session_uuid, team_uuid, permission_rules_json, network_policy_mode,
              web_search_mode, workspace_scope_json, approval_policy, version,
              created_at, updated_at
         FROM nano_session_runtime_config
        WHERE session_uuid = ?1
        LIMIT 1`,
    ).bind(sessionUuid).first<Record<string, unknown>>();
    return row ? rowToRuntimeConfig(row) : null;
  }

  async patch(input: {
    readonly session_uuid: string;
    readonly team_uuid: string;
    readonly permission_rules?: SessionRuntimePermissionRule[];
    readonly network_policy_mode?: string;
    readonly web_search_mode?: string;
    readonly workspace_scope?: { readonly mounts: readonly string[] };
    readonly approval_policy?: SessionApprovalPolicy;
  }): Promise<RuntimeConfigRow> {
    const current = await this.readOrCreate(input);
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    await this.db.prepare(
      `UPDATE nano_session_runtime_config
          SET permission_rules_json = ?2,
              network_policy_mode = ?3,
              web_search_mode = ?4,
              workspace_scope_json = ?5,
              approval_policy = ?6,
              version = ?7,
              updated_at = ?8
        WHERE session_uuid = ?1`,
    ).bind(
      input.session_uuid,
      JSON.stringify(input.permission_rules ?? current.permission_rules),
      input.network_policy_mode ?? current.network_policy.mode,
      input.web_search_mode ?? current.web_search.mode,
      JSON.stringify(input.workspace_scope ?? current.workspace_scope),
      input.approval_policy ?? current.approval_policy,
      nextVersion,
      now,
    ).run();
    const row = await this.read(input.session_uuid);
    if (!row) throw new Error("runtime config row lost after patch");
    return row;
  }
}
