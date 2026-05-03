// HPX5 P2 — local emit bridge from orchestrator-core route handlers to
// the attached User DO WebSocket. Wraps `emit-helpers.ts:emitTopLevelFrame`
// (zod validate + system.error fallback) and dispatches via
// `OrchestratorUserDO.__forward-frame` POST to reach the attached client.
//
// Usage (HPX5 F1/F2c/F4 callers):
//   await emitFrameViaUserDO(env, {
//     sessionUuid,
//     userUuid,
//     traceUuid,
//   }, "session.confirmation.request", body);
//
// All callers MUST pass user_uuid from session truth (see
// readOwnedSession in facade/routes/session-control.ts) so the User DO
// id is correct.

import {
  emitStreamEvent,
  emitTopLevelFrame,
  type EmitContext,
  type EmitResult,
  type EmitSink,
} from "@haimang/nacp-session";

import { getLogger, type OrchestratorCoreEnv } from "./facade/env.js";

export interface EmitTarget {
  readonly sessionUuid: string;
  readonly userUuid: string;
  readonly traceUuid: string;
}

function toForwardFrame(kindOrType: string, body: Record<string, unknown>): Record<string, unknown> {
  const wireBody =
    kindOrType.startsWith("session.item.") && typeof body.kind === "string"
      ? (() => {
          const { kind: itemKind, ...rest } = body;
          return { ...rest, item_kind: itemKind };
        })()
      : body;
  return { kind: kindOrType, ...wireBody };
}

async function forwardFrameToUserDO(
  env: OrchestratorCoreEnv,
  target: EmitTarget,
  frame: Record<string, unknown>,
): Promise<{ delivered: boolean; reason?: string }> {
  if (!env.ORCHESTRATOR_USER_DO) return { delivered: false, reason: "user-do-binding-missing" };
  const namespace = env.ORCHESTRATOR_USER_DO;
  const stub = namespace.get(namespace.idFromName(target.userUuid));
  const response = await stub.fetch(
    new Request(
      `https://orchestrator.internal/sessions/${target.sessionUuid}/__forward-frame`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trace-uuid": target.traceUuid,
        },
        body: JSON.stringify({ frame }),
      },
    ),
  );
  const payload = await response.json().catch(() => ({})) as { delivered?: unknown; reason?: unknown };
  return {
    delivered: response.ok && payload.delivered === true,
    ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}),
  };
}

/**
 * Construct an EmitSink that forwards to the User DO's `__forward-frame`
 * endpoint. The DO calls `emitServerFrame` which validates frame.kind
 * and pushes to the attached socket (`user-do-runtime.ts:990`).
 */
function makeUserDoSink(env: OrchestratorCoreEnv, target: EmitTarget): EmitSink {
  const send = (kindOrType: string, body: Record<string, unknown>): void => {
    if (!env.ORCHESTRATOR_USER_DO) {
      getLogger(env).warn("user-do-forward-unavailable", {
        code: "internal-error",
        ctx: {
          tag: "user-do-forward-unavailable",
          message_type: kindOrType,
          session_uuid: target.sessionUuid,
          reason: "user-do-binding-missing",
        },
      });
      return;
    }
    const frame = toForwardFrame(kindOrType, body);
    // Fire-and-forget; emit must never block row-write commit.
    void forwardFrameToUserDO(env, target, frame)
      .then((result) => {
        if (result.delivered) return;
        getLogger(env).warn("user-do-forward-undelivered", {
          code: "internal-error",
          ctx: {
            tag: "user-do-forward-undelivered",
            message_type: kindOrType,
            session_uuid: target.sessionUuid,
            reason: result.reason ?? "not-delivered",
          },
        });
      })
      .catch((error) => {
        getLogger(env).warn("user-do-forward-failed", {
          code: "internal-error",
          ctx: {
            tag: "user-do-forward-failed",
            message_type: kindOrType,
            session_uuid: target.sessionUuid,
            error: String(error),
          },
        });
      });
  };
  return {
    emitTopLevelFrame(messageType, body) {
      // body validated upstream via emit-helpers; here we just shape
      // the wire frame `{ kind: <messageType>, ...body }` per
      // user-do-runtime emitServerFrame contract.
      send(messageType, body);
    },
    emitStreamEvent(body) {
      // stream-event bodies have their own `kind` discriminator.
      const kind = (body as { kind?: string }).kind ?? "system.error";
      send(kind, body);
    },
  };
}

/**
 * HPX5 F1/F2c — emit a top-level WS frame from a route handler.
 * Returns the EmitResult so the caller can log latency / drop counters.
 */
export function emitFrameViaUserDO(
  env: OrchestratorCoreEnv,
  target: EmitTarget,
  messageType: string,
  body: Record<string, unknown>,
): EmitResult {
  const sink = makeUserDoSink(env, target);
  const ctx: EmitContext = {
    sessionUuid: target.sessionUuid,
    traceUuid: target.traceUuid,
    sourceWorker: "orchestrator-core",
  };
  const result = emitTopLevelFrame(sink, messageType, body, ctx, {
    onEmit(metric, fields) {
      if (metric === "drop" || metric === "fallback") {
        getLogger(env).warn("emit-helpers-fallback", {
          code: "internal-error",
          ctx: {
            tag: "emit-helpers-fallback",
            metric,
            message_type: fields.messageType,
            session_uuid: fields.sessionUuid,
            code: fields.code ?? null,
            latency_ms: fields.latency_ms,
          },
        });
      }
    },
  });
  return result;
}

export async function emitFrameViaUserDOAndWait(
  env: OrchestratorCoreEnv,
  target: EmitTarget,
  messageType: string,
  body: Record<string, unknown>,
): Promise<EmitResult & { delivered: boolean; reason?: string }> {
  const result = emitTopLevelFrame(
    {
      emitTopLevelFrame() {
        // Validated through emitTopLevelFrame; delivery is performed below.
      },
      emitStreamEvent() {
        // Not used for this top-level helper.
      },
    },
    messageType,
    body,
    {
      sessionUuid: target.sessionUuid,
      traceUuid: target.traceUuid,
      sourceWorker: "orchestrator-core",
    },
  );
  if (result.status !== "ok") return { ...result, delivered: false, reason: "emit-validation-failed" };
  const delivered = await forwardFrameToUserDO(env, target, toForwardFrame(messageType, body));
  return { ...result, ...delivered };
}

/**
 * HPX5 F4 — emit a stream-event sub-kind body (e.g. model.fallback).
 * Use this only for kinds already in the 13-kind discriminated union
 * (`SessionStreamEventBodySchema`).
 */
export function emitStreamEventViaUserDO(
  env: OrchestratorCoreEnv,
  target: EmitTarget,
  body: Record<string, unknown>,
): EmitResult {
  const sink = makeUserDoSink(env, target);
  const ctx: EmitContext = {
    sessionUuid: target.sessionUuid,
    traceUuid: target.traceUuid,
    sourceWorker: "orchestrator-core",
  };
  return emitStreamEvent(sink, body, ctx, {
    onEmit(metric, fields) {
      if (metric === "drop" || metric === "fallback") {
        getLogger(env).warn("emit-helpers-fallback", {
          code: "internal-error",
          ctx: {
            tag: "emit-helpers-fallback",
            metric,
            message_type: fields.messageType,
            session_uuid: fields.sessionUuid,
            code: fields.code ?? null,
            latency_ms: fields.latency_ms,
          },
        });
      }
    },
  });
}
