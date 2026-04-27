/**
 * ZX2 Phase 4 P4-04 — server WS frame compat layer.
 *
 * Background: prior to ZX2, orchestrator-core User DO and agent-core
 * Session DO produced server-to-client WebSocket frames as lightweight
 * `{ kind: '...', ... }` objects (e.g. `{ kind: 'session.heartbeat', ts }`,
 * `{ kind: 'attachment_superseded', ... }`, NDJSON event frames).
 *
 * `nacp-session` ships `NacpSessionFrameSchema` (extends
 * `NacpEnvelopeBaseSchema`) which requires header / authority / trace /
 * body. Wrapping every server frame in that envelope on the wire would
 * break the web + wechat clients that expect the lightweight shape.
 *
 * ZX2 decision: keep the lightweight shape on the wire (this is the
 * **compat layer**) and provide adapters here so:
 *   - new client paths can subscribe to a NACP-shaped frame source;
 *   - tests can assert the NACP equivalent;
 *   - the registry stays consistent with `nacp-session` schema.
 *
 * The lightweight `{kind, ...}` payloads are documented in
 * `clients/api-docs/session-ws-v1.md` as `inner.body` of the canonical
 * NACP frame. When session-ws-v2 ships the canonical frame on the wire,
 * the lightweight shape will be retired with a 1-week compat window.
 */

import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";

export interface LightweightServerFrame {
  readonly kind: string;
  readonly [extra: string]: unknown;
}

export interface FrameCompatContext {
  readonly sessionUuid: string;
  readonly traceUuid: string;
  readonly teamUuid?: string;
  readonly userUuid?: string;
  /** Stream sequence — use the User DO's current relay cursor. */
  readonly streamSeq?: number;
}

/**
 * Lift a lightweight `{kind, ...}` server frame into a NACP-session-frame-
 * shaped envelope. The envelope still rides on the same wire format
 * (lightweight JSON), but downstream consumers that want the NACP shape
 * can call this on what they receive (the orchestrator emits the
 * lightweight payload alongside `inner_lightweight: true` for now).
 *
 * For tests / new consumers — the result satisfies the structural shape
 * declared by `NacpSessionFrameSchema` (header.message_uuid, etc.). The
 * `body` field carries the ORIGINAL lightweight `{kind, ...}` payload so
 * the dual-shape mapping is lossless.
 */
export function liftLightweightFrame(
  raw: LightweightServerFrame,
  ctx: FrameCompatContext,
): Record<string, unknown> {
  const messageType = mapKindToMessageType(raw.kind);
  return {
    header: {
      schema_version: NACP_VERSION,
      message_uuid: crypto.randomUUID(),
      message_type: messageType,
      delivery_kind: messageType.endsWith(".event") ? "event" : "command",
      sent_at: new Date().toISOString(),
      producer_role: "session",
      producer_key: "nano-agent.orchestrator-core@v1",
      priority: "normal",
    },
    authority: {
      team_uuid: ctx.teamUuid ?? "unknown",
      ...(ctx.userUuid ? { user_uuid: ctx.userUuid } : {}),
      plan_level: "internal",
      stamped_by_key: "nano-agent.orchestrator-core@v1",
      stamped_at: new Date().toISOString(),
    },
    trace: {
      trace_uuid: ctx.traceUuid,
      session_uuid: ctx.sessionUuid,
      ...(ctx.streamSeq !== undefined ? { stream_seq: ctx.streamSeq } : {}),
    },
    body: raw,
    nacp_session_version: NACP_SESSION_VERSION,
  };
}

/**
 * Map a lightweight `kind` into the canonical NACP-session message type
 * registered in `packages/nacp-session/src/messages.ts` /
 * `type-direction-matrix.ts`. Unknown kinds map to
 * `session.stream.event` so existing event-shaped frames keep flowing
 * through the registry-validated path.
 */
export function mapKindToMessageType(kind: string): string {
  switch (kind) {
    case "session.heartbeat":
      return "session.heartbeat";
    case "session.stream.event":
    case "event":
      return "session.stream.event";
    case "session.end":
    case "terminal":
      return "session.end";
    case "session.permission.request":
      return "session.permission.request";
    case "session.permission.decision":
      return "session.permission.decision";
    case "session.usage.update":
      return "session.usage.update";
    case "session.skill.invoke":
      return "session.skill.invoke";
    case "session.command.invoke":
      return "session.command.invoke";
    case "session.elicitation.request":
      return "session.elicitation.request";
    case "session.elicitation.answer":
      return "session.elicitation.answer";
    case "attachment_superseded":
    case "meta":
      // These are control-plane lightweight frames; no NACP equivalent
      // yet (session-ws-v2 will introduce `session.attachment.superseded`
      // and `session.opened`). Until then we map to `session.stream.event`
      // so registry validation does not reject them.
      return "session.stream.event";
    default:
      return "session.stream.event";
  }
}
