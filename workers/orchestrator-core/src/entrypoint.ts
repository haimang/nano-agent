/**
 * RH1 P1-06b — orchestrator-core WorkerEntrypoint default export.
 *
 * Lives in its own module so that vitest can keep importing the test-friendly
 * `{ fetch }` worker object from `./index.js` without resolving the
 * `cloudflare:workers` module that only exists in the deployed runtime.
 *
 * Wrangler `main` points to this file's compiled output (`dist/entrypoint.js`).
 *
 * RPC surface:
 *   - `fetch(req)` — preserved HTTP path, delegates to `worker.fetch`
 *   - `forwardServerFrameToClient(sessionUuid, frame, meta)` — cross-worker
 *     WS push entry point. Called by agent-core's NanoSessionDO via
 *     ORCHESTRATOR_CORE service binding.
 *
 * Topology:
 *   agent-core ─[ORCHESTRATOR_CORE service binding]→ this RPC method
 *     ─[ORCHESTRATOR_USER_DO.idFromName(userUuid)]→ User DO `__forward-frame`
 *     ─→ User DO.emitServerFrame(sessionUuid, frame)
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import type { AuditRecord, LogRecord } from "@haimang/nacp-core/logger";
import { worker, NanoOrchestratorUserDO } from "./index.js";
import type { OrchestratorCoreEnv } from "./index.js";
import {
  createOrchestratorLogger,
  persistAuditRecord,
  persistErrorLogRecord,
} from "./observability.js";
import { cleanupObservabilityLogs } from "./cron/cleanup.js";
import type {
  ContextCompactCommitInput,
  ContextSnapshotWriteInput,
} from "./context-control-plane.js";
import {
  createCompactBoundaryJob as persistCompactBoundaryJob,
  createContextSnapshotRecord as persistContextSnapshotRecord,
  readContextCompactJob as loadContextCompactJob,
  readContextDurableState as loadContextDurableState,
} from "./context-control-plane.js";
import { D1ConfirmationControlPlane, type ConfirmationKind } from "./confirmation-control-plane.js";
import { D1TodoControlPlane, TodoConstraintError, type TodoStatus } from "./todo-control-plane.js";
import { D1ToolCallLedger, type ToolCallStatus } from "./tool-call-ledger.js";
import { D1RuntimeConfigPlane } from "./runtime-config-plane.js";
import { D1PermissionRulesPlane } from "./permission-rules-plane.js";
import { emitFrameViaUserDO } from "./wsemit.js";
import { runExecutorJob, type ExecutorJob } from "./executor-runtime.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// HP5-D1 (deferred-closure absorb) — emitter row-create.
// When a server frame is `session.permission.request` /
// `session.elicitation.request` (legacy compat surface) we eagerly
// create the corresponding `nano_session_confirmations` row before
// forwarding the frame. This satisfies HP5 closure §2 P1 unblock
// condition: `/confirmations?status=pending` immediately reflects the
// pending ask. Q16 row-first dual-write law: if the create succeeds we
// proceed; if the create fails (best-effort) we still forward the
// frame to keep legacy clients working — operator alarm via warn log.
async function emitterRowCreateBestEffort(
  db: D1Database | undefined,
  sessionUuid: string,
  frame: { readonly kind: string; readonly [k: string]: unknown },
  logger: { warn: (msg: string, ctx?: Record<string, unknown>) => void },
): Promise<void> {
  if (!db) return;
  let kind: ConfirmationKind | null = null;
  if (frame.kind === "session.permission.request") kind = "tool_permission";
  else if (frame.kind === "session.elicitation.request") kind = "elicitation";
  if (!kind) return;
  const requestUuid = typeof frame.request_uuid === "string" ? frame.request_uuid : null;
  if (!requestUuid || !UUID_RE.test(requestUuid)) return;
  const plane = new D1ConfirmationControlPlane(db);
  const now = new Date().toISOString();
  try {
    const existing = await plane.read({
      session_uuid: sessionUuid,
      confirmation_uuid: requestUuid,
    });
    if (existing) return;
    await plane.create({
      confirmation_uuid: requestUuid,
      session_uuid: sessionUuid,
      kind,
      payload: { ...frame, source: "emitter" },
      created_at: now,
      expires_at: null,
    });
  } catch (error) {
    logger.warn("hp5-emitter-row-create-failed", {
      code: "internal-error",
      ctx: {
        tag: "hp5-emitter-row-create-failed",
        session_uuid: sessionUuid,
        request_uuid: requestUuid,
        kind,
        error: String(error),
      },
    });
  }
}

interface ForwardServerFrameMeta {
  readonly userUuid: string;
  readonly teamUuid?: string;
  readonly traceUuid?: string;
}

interface ContextBindingMeta {
  readonly trace_uuid: string;
  readonly team_uuid: string;
}

function globLikeMatches(pattern: string | undefined, value: string): boolean {
  if (!pattern) return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value) || value.includes(pattern.replace(/\*/g, ""));
}

function runtimePolicyFallback(policy: string): "allow" | "deny" | "ask" {
  if (policy === "auto-allow" || policy === "always_allow") return "allow";
  if (policy === "deny") return "deny";
  return "ask";
}

export { NanoOrchestratorUserDO };

export default class OrchestratorCoreEntrypoint extends WorkerEntrypoint<OrchestratorCoreEnv> {
  async fetch(request: Request): Promise<Response> {
    return worker.fetch(request, this.env);
  }

  async scheduled(): Promise<void> {
    const logger = createOrchestratorLogger(this.env);
    try {
      const result = await cleanupObservabilityLogs(this.env);
      logger.info("observability-cleanup-complete", { ...result });
    } catch (error) {
      logger.error("observability-cleanup-failed", {
        code: "internal-error",
        ctx: { error: String(error) },
      });
      throw error;
    }
  }

  async queue(batch: MessageBatch<ExecutorJob>): Promise<void> {
    for (const message of batch.messages) {
      await runExecutorJob(this.env, message.body);
      message.ack();
    }
  }

  async recordErrorLog(record: LogRecord): Promise<{ ok: boolean }> {
    await persistErrorLogRecord(this.env, record);
    return { ok: true };
  }

  async recordAuditEvent(record: AuditRecord): Promise<{ ok: boolean }> {
    await persistAuditRecord(this.env, record);
    return { ok: true };
  }

  /**
   * HPX5 F2b — agent-core WriteTodos capability backend.
   *
   * Called from agent-core capability transport when LLM emits
   * `tool_use { name: "write_todos" }`. Honors HP6 Q19 invariant:
   * at-most-1 in_progress per session — the host auto-closes any
   * existing in_progress todo before creating new ones (downgrades
   * it to `pending`).
   *
   * Returns the created/updated todos plus the list of auto-closed
   * (downgraded) todo_uuids so the LLM can see what happened.
   *
   * Frame emit path: every successful write triggers a
   * `session.todos.update` push via emitFrameViaUserDO (HPX5 F2c).
   */
  async writeTodos(
    input: {
      readonly session_uuid: string;
      readonly conversation_uuid: string;
      readonly team_uuid: string;
      readonly user_uuid: string;
      readonly trace_uuid: string;
      readonly todos: ReadonlyArray<{
        readonly content: string;
        readonly status?: TodoStatus;
        readonly parent_todo_uuid?: string | null;
      }>;
    },
  ): Promise<
    | {
        readonly ok: true;
        readonly created: ReadonlyArray<{ readonly todo_uuid: string; readonly status: TodoStatus }>;
        readonly auto_closed: ReadonlyArray<{ readonly todo_uuid: string }>;
      }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  > {
    if (!UUID_RE.test(input.session_uuid)) {
      return { ok: false, error: { code: "invalid-input", message: "session_uuid must be UUID" } };
    }
    if (!Array.isArray(input.todos) || input.todos.length === 0) {
      return { ok: false, error: { code: "invalid-input", message: "todos must be a non-empty array" } };
    }
    const db = this.env.NANO_AGENT_DB;
    if (!db) {
      return { ok: false, error: { code: "worker-misconfigured", message: "NANO_AGENT_DB binding missing" } };
    }
    const plane = new D1TodoControlPlane(db);
    const now = new Date().toISOString();

    // Auto-close any existing in_progress todo (HP6 Q19 invariant).
    const autoClosed: Array<{ todo_uuid: string }> = [];
    const inProgressIncoming = input.todos.some((t) => t.status === "in_progress");
    if (inProgressIncoming) {
      const inProgressList = await plane.list({ session_uuid: input.session_uuid, status: "in_progress" });
      for (const row of inProgressList) {
        try {
          await plane.patch({
            session_uuid: input.session_uuid,
            todo_uuid: row.todo_uuid,
            status: "pending",
            updated_at: now,
          });
          autoClosed.push({ todo_uuid: row.todo_uuid });
        } catch {
          // ignore — best-effort auto-close
        }
      }
    }

    // Allow only the first incoming in_progress; demote the rest to pending.
    let inProgressTaken = false;
    const created: Array<{ todo_uuid: string; status: TodoStatus }> = [];
    for (const item of input.todos) {
      const content = String(item.content ?? "").trim();
      if (content.length === 0 || content.length > 2000) continue;
      let desiredStatus: TodoStatus = item.status ?? "pending";
      if (desiredStatus === "in_progress") {
        if (inProgressTaken) {
          desiredStatus = "pending";
        } else {
          inProgressTaken = true;
        }
      }
      try {
        const todo = await plane.create({
          session_uuid: input.session_uuid,
          conversation_uuid: input.conversation_uuid,
          team_uuid: input.team_uuid,
          content,
          status: desiredStatus,
          parent_todo_uuid: item.parent_todo_uuid ?? null,
          created_at: now,
        });
        created.push({ todo_uuid: todo.todo_uuid, status: todo.status });
      } catch (err) {
        if (err instanceof TodoConstraintError) {
          // skip on per-row constraint failure; continue with the rest
          continue;
        }
        throw err;
      }
    }

    // HPX5 F2c — emit `session.todos.update` after successful writes.
    if (created.length > 0) {
      const fullList = await plane.list({ session_uuid: input.session_uuid });
      emitFrameViaUserDO(
        this.env,
        {
          sessionUuid: input.session_uuid,
          userUuid: input.user_uuid,
          traceUuid: input.trace_uuid,
        },
        "session.todos.update",
        {
          session_uuid: input.session_uuid,
          todos: fullList,
        },
      );
    }

    return { ok: true, created, auto_closed: autoClosed };
  }

  async recordToolCall(
    input: {
      readonly request_uuid: string;
      readonly session_uuid: string;
      readonly team_uuid: string;
      readonly turn_uuid?: string | null;
      readonly tool_name: string;
      readonly input?: Record<string, unknown>;
      readonly output?: Record<string, unknown> | null;
      readonly status: ToolCallStatus;
    },
    meta?: { readonly trace_uuid?: string; readonly team_uuid?: string },
  ): Promise<{ ok: boolean }> {
    if (!input.request_uuid || !input.session_uuid || !input.team_uuid || !input.tool_name) {
      return { ok: false };
    }
    if (meta?.team_uuid && meta.team_uuid !== input.team_uuid) return { ok: false };
    const db = this.env.NANO_AGENT_DB;
    if (!db) return { ok: false };
    await new D1ToolCallLedger(db).upsert({
      request_uuid: input.request_uuid,
      session_uuid: input.session_uuid,
      team_uuid: input.team_uuid,
      turn_uuid: input.turn_uuid ?? null,
      tool_name: input.tool_name,
      input: input.input,
      output: input.output,
      status: input.status,
      ended_at: input.status === "running" || input.status === "queued" ? null : new Date().toISOString(),
    });
    return { ok: true };
  }

  async authorizeToolUse(
    input: {
      readonly session_uuid: string;
      readonly team_uuid: string;
      readonly tool_name: string;
      readonly tool_input?: Record<string, unknown>;
    },
    meta?: { readonly trace_uuid?: string; readonly team_uuid?: string },
  ): Promise<{
    readonly ok: boolean;
    readonly decision: "allow" | "deny" | "ask";
    readonly source: "session-rule" | "tenant-rule" | "approval-policy" | "unavailable";
    readonly reason?: string;
  }> {
    if (!UUID_RE.test(input.session_uuid) || !input.team_uuid || !input.tool_name) {
      return { ok: false, decision: "deny", source: "unavailable", reason: "invalid-input" };
    }
    if (meta?.team_uuid && meta.team_uuid !== input.team_uuid) {
      return { ok: false, decision: "deny", source: "unavailable", reason: "team-mismatch" };
    }
    const db = this.env.NANO_AGENT_DB;
    if (!db) return { ok: false, decision: "ask", source: "unavailable", reason: "db-missing" };

    const runtime = await new D1RuntimeConfigPlane(db).readOrCreate({
      session_uuid: input.session_uuid,
      team_uuid: input.team_uuid,
    });
    const inputProbe = JSON.stringify(input.tool_input ?? {});
    const sessionRule = runtime.permission_rules.find(
      (rule) =>
        rule.tool_name === input.tool_name &&
        globLikeMatches(rule.pattern, inputProbe),
    );
    if (sessionRule) {
      return { ok: true, decision: sessionRule.behavior, source: "session-rule" };
    }

    const tenantRule = (await new D1PermissionRulesPlane(db).listTeamRules(input.team_uuid)).find(
      (rule) =>
        rule.tool_name === input.tool_name &&
        globLikeMatches(rule.pattern, inputProbe),
    );
    if (tenantRule) {
      return { ok: true, decision: tenantRule.behavior, source: "tenant-rule" };
    }

    return {
      ok: true,
      decision: runtimePolicyFallback(runtime.approval_policy),
      source: "approval-policy",
    };
  }

  async readContextDurableState(
    sessionUuid: string,
    teamUuid: string,
    meta: ContextBindingMeta,
  ) {
    if (
      typeof sessionUuid !== "string" ||
      !UUID_RE.test(sessionUuid) ||
      typeof teamUuid !== "string" ||
      teamUuid.length === 0
    ) {
      return null;
    }
    if (!meta || meta.team_uuid !== teamUuid) return null;
    return loadContextDurableState(this.env.NANO_AGENT_DB, sessionUuid, teamUuid);
  }

  async createContextSnapshot(
    sessionUuid: string,
    teamUuid: string,
    input: Omit<ContextSnapshotWriteInput, "session_uuid" | "team_uuid">,
    meta: ContextBindingMeta,
  ) {
    if (
      typeof sessionUuid !== "string" ||
      !UUID_RE.test(sessionUuid) ||
      typeof teamUuid !== "string" ||
      teamUuid.length === 0
    ) {
      return null;
    }
    if (!meta || meta.team_uuid !== teamUuid) return null;
    return persistContextSnapshotRecord(this.env.NANO_AGENT_DB, {
      ...input,
      session_uuid: sessionUuid,
      team_uuid: teamUuid,
    });
  }

  async commitContextCompact(
    sessionUuid: string,
    teamUuid: string,
    input: Omit<ContextCompactCommitInput, "session_uuid" | "team_uuid">,
    meta: ContextBindingMeta,
  ) {
    if (
      typeof sessionUuid !== "string" ||
      !UUID_RE.test(sessionUuid) ||
      typeof teamUuid !== "string" ||
      teamUuid.length === 0
    ) {
      return null;
    }
    if (!meta || meta.team_uuid !== teamUuid) return null;
    return persistCompactBoundaryJob(this.env.NANO_AGENT_DB, {
      ...input,
      session_uuid: sessionUuid,
      team_uuid: teamUuid,
    });
  }

  async readContextCompactJob(
    sessionUuid: string,
    teamUuid: string,
    jobId: string,
    meta: ContextBindingMeta,
  ) {
    if (
      typeof sessionUuid !== "string" ||
      !UUID_RE.test(sessionUuid) ||
      typeof teamUuid !== "string" ||
      teamUuid.length === 0 ||
      typeof jobId !== "string" ||
      !UUID_RE.test(jobId)
    ) {
      return null;
    }
    if (!meta || meta.team_uuid !== teamUuid) return null;
    return loadContextCompactJob(this.env.NANO_AGENT_DB, sessionUuid, teamUuid, jobId);
  }

  async forwardServerFrameToClient(
    sessionUuid: string,
    frame: { readonly kind: string; readonly [k: string]: unknown },
    meta: ForwardServerFrameMeta,
  ): Promise<{ ok: boolean; delivered: boolean; reason?: string }> {
    if (typeof sessionUuid !== "string" || !UUID_RE.test(sessionUuid)) {
      return { ok: false, delivered: false, reason: "invalid-session-uuid" };
    }
    if (!frame || typeof frame !== "object" || typeof frame.kind !== "string") {
      return { ok: false, delivered: false, reason: "invalid-frame" };
    }
    if (!meta || typeof meta.userUuid !== "string" || meta.userUuid.length === 0) {
      return { ok: false, delivered: false, reason: "missing-user-uuid" };
    }
    if (!this.env.ORCHESTRATOR_USER_DO) {
      return { ok: false, delivered: false, reason: "user-do-binding-missing" };
    }
    const logger = createOrchestratorLogger(this.env);
    // HP5-D1 emitter row-create (best-effort; never blocks frame delivery)
    await emitterRowCreateBestEffort(
      this.env.NANO_AGENT_DB,
      sessionUuid,
      frame,
      logger,
    );
    try {
      const stub = this.env.ORCHESTRATOR_USER_DO.get(
        this.env.ORCHESTRATOR_USER_DO.idFromName(meta.userUuid),
      );
      const internalUrl = new URL(
        `https://orchestrator.internal/sessions/${sessionUuid}/__forward-frame`,
      );
      const response = await stub.fetch(
        new Request(internalUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-trace-uuid": meta.traceUuid ?? crypto.randomUUID(),
          },
          body: JSON.stringify({ frame }),
        }),
      );
      const body = (await response.json().catch(() => ({}))) as {
        delivered?: boolean;
        reason?: string;
      };
      return {
        ok: response.ok,
        delivered: Boolean(body.delivered),
        reason: body.reason,
      };
    } catch (error) {
      logger.warn("forward-server-frame-failed", {
        code: "internal-error",
        ctx: {
          tag: "forward-server-frame-failed",
          session_uuid: sessionUuid,
          user_uuid: meta.userUuid,
          error: String(error),
        },
      });
      return { ok: false, delivered: false, reason: "do-fetch-error" };
    }
  }
}
