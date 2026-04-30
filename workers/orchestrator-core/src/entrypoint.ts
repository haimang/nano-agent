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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ForwardServerFrameMeta {
  readonly userUuid: string;
  readonly teamUuid?: string;
  readonly traceUuid?: string;
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
