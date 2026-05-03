// HP5 P1-01 — confirmation control plane durable helper.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.6 HP5
//   * docs/design/hero-to-pro/HP5-confirmation-control-plane.md §7 F1/F3/F5
//   * docs/design/hero-to-pro/HPX-qna.md Q16-Q18 / Q39
//   * workers/orchestrator-core/migrations/012-session-confirmations.sql
//
// Frozen invariants (HP5 must NOT extend without §3 correction in HP1):
//   * kind ∈ { tool_permission, elicitation, model_switch, context_compact,
//             fallback_model, checkpoint_restore, context_loss }
//     — exactly 7 kinds; Q18 forbids `tool_cancel` and forbids `custom`.
//   * status ∈ { pending, allowed, denied, modified, timeout, superseded }
//     — exactly 6 statuses; Q16 forbids `failed`. Failed-rollback /
//       replaced confirmations terminate as `superseded`.
//
// HP5 first-wave live writers: `tool_permission` + `elicitation`.
// Other 5 kinds are schema-frozen and accepted by API surface, but
// have no live caller until HP3 / HP4 / HP6 / HP7 take their slots.

export const CONFIRMATION_KINDS = [
  "tool_permission",
  "elicitation",
  "model_switch",
  "context_compact",
  "fallback_model",
  "checkpoint_restore",
  "context_loss",
] as const;
export type ConfirmationKind = (typeof CONFIRMATION_KINDS)[number];
const CONFIRMATION_KIND_SET = new Set<string>(CONFIRMATION_KINDS);

export const CONFIRMATION_STATUSES = [
  "pending",
  "allowed",
  "denied",
  "modified",
  "timeout",
  "superseded",
] as const;
export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

export const CONFIRMATION_TERMINAL_STATUSES = new Set<ConfirmationStatus>([
  "allowed",
  "denied",
  "modified",
  "timeout",
  "superseded",
]);

export interface ConfirmationRow {
  readonly confirmation_uuid: string;
  readonly session_uuid: string;
  readonly kind: ConfirmationKind;
  readonly payload: Record<string, unknown>;
  readonly status: ConfirmationStatus;
  readonly decision_payload: Record<string, unknown> | null;
  readonly created_at: string;
  readonly decided_at: string | null;
  readonly expires_at: string | null;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function rowToConfirmation(row: Record<string, unknown>): ConfirmationRow {
  return {
    confirmation_uuid: String(row.confirmation_uuid),
    session_uuid: String(row.session_uuid),
    kind: String(row.kind) as ConfirmationKind,
    payload: parseJsonObject(row.payload_json) ?? {},
    status: String(row.status) as ConfirmationStatus,
    decision_payload: parseJsonObject(row.decision_payload_json),
    created_at: String(row.created_at),
    decided_at: typeof row.decided_at === "string" ? row.decided_at : null,
    expires_at: typeof row.expires_at === "string" ? row.expires_at : null,
  };
}

export class D1ConfirmationControlPlane {
  constructor(private readonly db: D1Database) {}

  // Future-use public guard for routes/tests that need to validate the frozen
  // 7-kind registry without duplicating the private set.
  isKnownKind(value: string): value is ConfirmationKind {
    return CONFIRMATION_KIND_SET.has(value);
  }

  async create(input: {
    readonly confirmation_uuid: string;
    readonly session_uuid: string;
    readonly kind: ConfirmationKind;
    readonly payload: Record<string, unknown>;
    readonly created_at: string;
    readonly expires_at: string | null;
  }): Promise<ConfirmationRow | null> {
    await this.db
      .prepare(
        `INSERT INTO nano_session_confirmations (
           confirmation_uuid,
           session_uuid,
           kind,
           payload_json,
           status,
           decision_payload_json,
           created_at,
           decided_at,
           expires_at
         ) VALUES (?1, ?2, ?3, ?4, 'pending', NULL, ?5, NULL, ?6)`,
      )
      .bind(
        input.confirmation_uuid,
        input.session_uuid,
        input.kind,
        JSON.stringify(input.payload),
        input.created_at,
        input.expires_at,
      )
      .run();
    return this.read({
      session_uuid: input.session_uuid,
      confirmation_uuid: input.confirmation_uuid,
    });
  }

  async read(input: {
    readonly session_uuid: string;
    readonly confirmation_uuid: string;
  }): Promise<ConfirmationRow | null> {
    const row = await this.db
      .prepare(
        `SELECT
           confirmation_uuid,
           session_uuid,
           kind,
           payload_json,
           status,
           decision_payload_json,
           created_at,
           decided_at,
           expires_at
         FROM nano_session_confirmations
         WHERE confirmation_uuid = ?1
           AND session_uuid = ?2
         LIMIT 1`,
      )
      .bind(input.confirmation_uuid, input.session_uuid)
      .first<Record<string, unknown>>();
    return row ? rowToConfirmation(row) : null;
  }

  async list(input: {
    readonly session_uuid: string;
    readonly status?: ConfirmationStatus | "any";
    readonly limit?: number;
  }): Promise<ConfirmationRow[]> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const filterStatus = input.status === "any" ? null : (input.status ?? null);
    const rows = filterStatus
      ? await this.db
          .prepare(
            `SELECT
               confirmation_uuid,
               session_uuid,
               kind,
               payload_json,
               status,
               decision_payload_json,
               created_at,
               decided_at,
               expires_at
             FROM nano_session_confirmations
             WHERE session_uuid = ?1
               AND status = ?2
             ORDER BY created_at DESC, confirmation_uuid DESC
             LIMIT ?3`,
          )
          .bind(input.session_uuid, filterStatus, limit)
          .all<Record<string, unknown>>()
      : await this.db
          .prepare(
            `SELECT
               confirmation_uuid,
               session_uuid,
               kind,
               payload_json,
               status,
               decision_payload_json,
               created_at,
               decided_at,
               expires_at
             FROM nano_session_confirmations
             WHERE session_uuid = ?1
             ORDER BY created_at DESC, confirmation_uuid DESC
             LIMIT ?2`,
          )
          .bind(input.session_uuid, limit)
          .all<Record<string, unknown>>();
    return (rows.results ?? []).map(rowToConfirmation);
  }

  /**
   * Apply a decision to a pending confirmation.
   *
   * Frozen law (Q16):
   *   - If the row is already terminal, return the existing row + a
   *     `conflict` flag so callers can decide whether to retry / surface
   *     the conflict; do NOT silently overwrite.
   *   - On row-first dual-write failure (downstream DO wakeup not happy),
   *     callers MUST recall this with status `superseded` and a
   *     decision_payload that records the original decision attempt.
   *   - We never write `failed` here; the schema does not allow it.
   */
  async applyDecision(input: {
    readonly session_uuid: string;
    readonly confirmation_uuid: string;
    readonly status: ConfirmationStatus;
    readonly decision_payload: Record<string, unknown> | null;
    readonly decided_at: string;
  }): Promise<{ readonly row: ConfirmationRow | null; readonly conflict: boolean }> {
    if (input.status === "pending") {
      throw new Error("applyDecision requires a terminal status");
    }
    const existing = await this.read({
      session_uuid: input.session_uuid,
      confirmation_uuid: input.confirmation_uuid,
    });
    if (!existing) return { row: null, conflict: false };
    if (CONFIRMATION_TERMINAL_STATUSES.has(existing.status)) {
      return { row: existing, conflict: existing.status !== input.status };
    }
    await this.db
      .prepare(
        `UPDATE nano_session_confirmations
            SET status = ?3,
                decision_payload_json = ?4,
                decided_at = ?5
          WHERE confirmation_uuid = ?1
            AND session_uuid = ?2
            AND status = 'pending'`,
      )
      .bind(
        input.confirmation_uuid,
        input.session_uuid,
        input.status,
        input.decision_payload ? JSON.stringify(input.decision_payload) : null,
        input.decided_at,
      )
      .run();
    const next = await this.read({
      session_uuid: input.session_uuid,
      confirmation_uuid: input.confirmation_uuid,
    });
    return { row: next, conflict: false };
  }

  /**
   * HP5 P3-03 fallback. When the row write succeeded but the downstream
   * DO storage primitive (recordAsyncAnswer) failed, the row must NOT
   * stay `pending` (it would block list semantics) and must NOT become
   * `failed` (Q16). We mark it `superseded` and attach the failure
   * details so support / audit can replay the original intent.
   */
  async markSupersededOnDualWriteFailure(input: {
    readonly session_uuid: string;
    readonly confirmation_uuid: string;
    readonly attempted_status: ConfirmationStatus;
    readonly attempted_decision: Record<string, unknown> | null;
    readonly failure_reason: string;
    readonly decided_at: string;
  }): Promise<ConfirmationRow | null> {
    await this.db
      .prepare(
        `UPDATE nano_session_confirmations
            SET status = 'superseded',
                decision_payload_json = ?3,
                decided_at = ?4
          WHERE confirmation_uuid = ?1
            AND session_uuid = ?2
            AND status = ?5`,
      )
      .bind(
        input.confirmation_uuid,
        input.session_uuid,
        JSON.stringify({
          attempted_status: input.attempted_status,
          attempted_decision: input.attempted_decision,
          failure_reason: input.failure_reason,
          superseded_at: input.decided_at,
        }),
        input.decided_at,
        input.attempted_status,
      )
      .run();
    return this.read({
      session_uuid: input.session_uuid,
      confirmation_uuid: input.confirmation_uuid,
    });
  }
}
