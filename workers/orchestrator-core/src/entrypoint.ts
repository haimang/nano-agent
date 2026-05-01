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

  async recordErrorLog(record: LogRecord): Promise<{ ok: boolean }> {
    await persistErrorLogRecord(this.env, record);
    return { ok: true };
  }

  async recordAuditEvent(record: AuditRecord): Promise<{ ok: boolean }> {
    await persistAuditRecord(this.env, record);
    return { ok: true };
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
