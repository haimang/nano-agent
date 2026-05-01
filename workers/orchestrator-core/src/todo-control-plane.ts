// HP6 P1-01 — todo durable registry helper.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.7 HP6
//   * docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md §7 F1
//   * workers/orchestrator-core/migrations/010-agentic-loop-todos.sql
//
// Frozen invariants (HP6 must NOT extend without §3 schema correction
// in HP1):
//   * status ∈ { pending, in_progress, completed, cancelled, blocked }
//     — exactly 5 statuses; any future addition triggers HP1 correction.
//   * At-most-1 in_progress per session — enforced at the application
//     layer here (D1 has no session-scoped CHECK / partial UNIQUE for
//     this constraint without a trigger; we apply a transactional read
//     + write pattern).
//
// HP6 first-wave deliberately keeps `DELETE` as a hard delete (no
// `deleted_at`); deletion lineage lives in audit / message ledger,
// per HP6 design §7.2 F1 边界情况.

export const TODO_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "blocked",
] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

const TERMINAL_TODO_STATUSES = new Set<TodoStatus>([
  "completed",
  "cancelled",
]);

export interface TodoRow {
  readonly todo_uuid: string;
  readonly session_uuid: string;
  readonly conversation_uuid: string;
  readonly team_uuid: string;
  readonly parent_todo_uuid: string | null;
  readonly content: string;
  readonly status: TodoStatus;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
}

function rowToTodo(row: Record<string, unknown>): TodoRow {
  return {
    todo_uuid: String(row.todo_uuid),
    session_uuid: String(row.session_uuid),
    conversation_uuid: String(row.conversation_uuid),
    team_uuid: String(row.team_uuid),
    parent_todo_uuid:
      typeof row.parent_todo_uuid === "string" ? row.parent_todo_uuid : null,
    content: String(row.content),
    status: String(row.status) as TodoStatus,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at:
      typeof row.completed_at === "string" ? row.completed_at : null,
  };
}

function isTerminalStatus(status: TodoStatus): boolean {
  return TERMINAL_TODO_STATUSES.has(status);
}

export class TodoConstraintError extends Error {
  constructor(
    public readonly code: "in-progress-conflict",
    message: string,
  ) {
    super(message);
    this.name = "TodoConstraintError";
  }
}

export class D1TodoControlPlane {
  constructor(private readonly db: D1Database) {}

  async list(input: {
    readonly session_uuid: string;
    readonly status?: TodoStatus | "any";
  }): Promise<TodoRow[]> {
    const filter = input.status === "any" ? null : (input.status ?? null);
    const rows = filter
      ? await this.db
          .prepare(
            `SELECT
               todo_uuid, session_uuid, conversation_uuid, team_uuid,
               parent_todo_uuid, content, status,
               created_at, updated_at, completed_at
             FROM nano_session_todos
             WHERE session_uuid = ?1
               AND status = ?2
             ORDER BY created_at ASC, todo_uuid ASC`,
          )
          .bind(input.session_uuid, filter)
          .all<Record<string, unknown>>()
      : await this.db
          .prepare(
            `SELECT
               todo_uuid, session_uuid, conversation_uuid, team_uuid,
               parent_todo_uuid, content, status,
               created_at, updated_at, completed_at
             FROM nano_session_todos
             WHERE session_uuid = ?1
             ORDER BY created_at ASC, todo_uuid ASC`,
          )
          .bind(input.session_uuid)
          .all<Record<string, unknown>>();
    return (rows.results ?? []).map(rowToTodo);
  }

  async read(input: {
    readonly session_uuid: string;
    readonly todo_uuid: string;
  }): Promise<TodoRow | null> {
    const row = await this.db
      .prepare(
        `SELECT
           todo_uuid, session_uuid, conversation_uuid, team_uuid,
           parent_todo_uuid, content, status,
           created_at, updated_at, completed_at
         FROM nano_session_todos
         WHERE todo_uuid = ?1 AND session_uuid = ?2
         LIMIT 1`,
      )
      .bind(input.todo_uuid, input.session_uuid)
      .first<Record<string, unknown>>();
    return row ? rowToTodo(row) : null;
  }

  private async readActiveInProgress(
    sessionUuid: string,
  ): Promise<string | null> {
    const row = await this.db
      .prepare(
        `SELECT todo_uuid
           FROM nano_session_todos
          WHERE session_uuid = ?1
            AND status = 'in_progress'
          LIMIT 1`,
      )
      .bind(sessionUuid)
      .first<{ todo_uuid?: string }>();
    return typeof row?.todo_uuid === "string" ? row.todo_uuid : null;
  }

  async create(input: {
    readonly session_uuid: string;
    readonly conversation_uuid: string;
    readonly team_uuid: string;
    readonly content: string;
    readonly status?: TodoStatus;
    readonly parent_todo_uuid?: string | null;
    readonly created_at: string;
  }): Promise<TodoRow> {
    // HPX3 F1 — handler 已在 facade 层 pre-validate status enum，
    // domain 层不再抛 `invalid-status`（dead code）；此处直接信任 input。
    const status: TodoStatus = input.status ?? "pending";
    if (status === "in_progress") {
      const conflict = await this.readActiveInProgress(input.session_uuid);
      if (conflict) {
        throw new TodoConstraintError(
          "in-progress-conflict",
          `session already has an in_progress todo: ${conflict}`,
        );
      }
    }
    const todoUuid = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO nano_session_todos (
           todo_uuid, session_uuid, conversation_uuid, team_uuid,
           parent_todo_uuid, content, status, created_at, updated_at, completed_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        todoUuid,
        input.session_uuid,
        input.conversation_uuid,
        input.team_uuid,
        input.parent_todo_uuid ?? null,
        input.content,
        status,
        input.created_at,
        input.created_at,
        isTerminalStatus(status) ? input.created_at : null,
      )
      .run();
    const row = await this.read({
      session_uuid: input.session_uuid,
      todo_uuid: todoUuid,
    });
    if (!row) {
      throw new Error("failed to read newly created todo");
    }
    return row;
  }

  async patch(input: {
    readonly session_uuid: string;
    readonly todo_uuid: string;
    readonly content?: string;
    readonly status?: TodoStatus;
    readonly updated_at: string;
  }): Promise<TodoRow | null> {
    // HPX3 F5 — row not found 走 `null` return（handler 映射为 404 not-found），
    // 不再抛 `todo-not-found`；HPX3 F1 — status enum 已在 handler pre-validate。
    const existing = await this.read({
      session_uuid: input.session_uuid,
      todo_uuid: input.todo_uuid,
    });
    if (!existing) return null;
    if (
      input.status === "in_progress" &&
      existing.status !== "in_progress"
    ) {
      const conflict = await this.readActiveInProgress(input.session_uuid);
      if (conflict && conflict !== input.todo_uuid) {
        throw new TodoConstraintError(
          "in-progress-conflict",
          `session already has an in_progress todo: ${conflict}`,
        );
      }
    }
    const nextStatus = input.status ?? existing.status;
    const nextContent = input.content ?? existing.content;
    const completedAt =
      input.status !== undefined && isTerminalStatus(input.status)
        ? input.updated_at
        : existing.completed_at;
    await this.db
      .prepare(
        `UPDATE nano_session_todos
            SET content = ?3,
                status = ?4,
                updated_at = ?5,
                completed_at = ?6
          WHERE todo_uuid = ?1
            AND session_uuid = ?2`,
      )
      .bind(
        input.todo_uuid,
        input.session_uuid,
        nextContent,
        nextStatus,
        input.updated_at,
        completedAt,
      )
      .run();
    return this.read({
      session_uuid: input.session_uuid,
      todo_uuid: input.todo_uuid,
    });
  }

  async delete(input: {
    readonly session_uuid: string;
    readonly todo_uuid: string;
  }): Promise<boolean> {
    const existing = await this.read({
      session_uuid: input.session_uuid,
      todo_uuid: input.todo_uuid,
    });
    if (!existing) return false;
    await this.db
      .prepare(
        `DELETE FROM nano_session_todos
          WHERE todo_uuid = ?1
            AND session_uuid = ?2`,
      )
      .bind(input.todo_uuid, input.session_uuid)
      .run();
    return true;
  }
}
