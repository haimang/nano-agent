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

/**
 * Construct an EmitSink that forwards to the User DO's `__forward-frame`
 * endpoint. The DO calls `emitServerFrame` which validates frame.kind
 * and pushes to the attached socket (`user-do-runtime.ts:990`).
 */
function makeUserDoSink(env: OrchestratorCoreEnv, target: EmitTarget): EmitSink {
  const send = (kindOrType: string, body: Record<string, unknown>): void => {
    if (!env.ORCHESTRATOR_USER_DO) return;
    const namespace = env.ORCHESTRATOR_USER_DO;
    const stub = namespace.get(namespace.idFromName(target.userUuid));
    const wireBody =
      kindOrType.startsWith("session.item.") && typeof body.kind === "string"
        ? (() => {
            const { kind: itemKind, ...rest } = body;
            return { ...rest, item_kind: itemKind };
          })()
        : body;
    const frame: Record<string, unknown> = { kind: kindOrType, ...wireBody };
    // Fire-and-forget; emit must never block row-write commit. Errors are
    // swallowed at the caller via observer / system.error fallback.
    void stub
      .fetch(
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
      )
      .catch(() => {
        // intentionally swallow: emit failure already counted via observer
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
