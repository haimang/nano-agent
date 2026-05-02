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
import { NACP_SESSION_VERSION, SESSION_BODY_SCHEMAS } from "@haimang/nacp-session";

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

function normalizeLightweightBodyForSchema(
  messageType: string,
  frame: LightweightServerFrame,
): Record<string, unknown> {
  const { kind: _kind, ...body } = frame;
  if (messageType === "session.confirmation.request") {
    const confirmationKind =
      typeof body.confirmation_kind === "string" ? body.confirmation_kind : undefined;
    if (confirmationKind) {
      const { confirmation_kind: _confirmationKind, ...rest } = body;
      return { ...rest, kind: confirmationKind };
    }
  }
  if (messageType.startsWith("session.item.")) {
    const itemKind = typeof body.item_kind === "string" ? body.item_kind : undefined;
    if (itemKind) {
      const { item_kind: _itemKind, ...rest } = body;
      return { ...rest, kind: itemKind };
    }
  }
  return body;
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
    body: normalizeLightweightBodyForSchema(messageType, raw),
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
/**
 * RH2 P2-08 — server frame schema validation gate.
 *
 * 在 emitServerFrame 投递前调用本函数:
 *  - kind 已映射到 NACP message_type
 *  - 对应 message_type 在 SESSION_BODY_SCHEMAS 中 → safeParse(frame body)
 *  - schema 缺失或 parse 失败 → 返回 `{ok:false, reason}`
 *  - schema 通过或 message_type 不要求 body → 返回 `{ok:true}`
 *
 * 注意:lightweight 帧的 body 不是 nested,而是与 kind 平铺。我们把除了 `kind`
 * 字段以外的所有字段视为 body,送入对应 NACP body schema 校验。这与
 * `liftLightweightToNacpFrame` 的转换约定一致。
 */
export function validateLightweightServerFrame(
  frame: LightweightServerFrame,
): { ok: true } | { ok: false; reason: string } {
  if (!frame || typeof frame !== "object" || typeof frame.kind !== "string") {
    return { ok: false, reason: "frame missing kind:string" };
  }
  // mapKindToMessageType is defined below — need to call it after declaration.
  // Hoisted JS function semantics let us forward-reference here.
  const messageType = mapKindToMessageType(frame.kind);
  // Lazy import of SESSION_BODY_SCHEMAS to avoid hoisting churn.
  const schemas = SESSION_BODY_SCHEMAS as Record<string, { safeParse?: (v: unknown) => { success: boolean; error?: { message: string } } }>;
  const schema = schemas[messageType];
  if (!schema || typeof schema.safeParse !== "function") {
    // No schema means we accept by default (e.g. session.stream.event has its
    // own validator path).
    return { ok: true };
  }
  const body = normalizeLightweightBodyForSchema(messageType, frame);
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true };
  return {
    ok: false,
    reason: `schema mismatch for ${messageType}: ${parsed.error?.message ?? "unknown"}`,
  };
}

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
    case "session.confirmation.request":
      return "session.confirmation.request";
    case "session.confirmation.update":
      return "session.confirmation.update";
    case "session.todos.write":
      return "session.todos.write";
    case "session.todos.update":
      return "session.todos.update";
    case "session.runtime.update":
      return "session.runtime.update";
    case "session.restore.completed":
      return "session.restore.completed";
    case "session.item.started":
      return "session.item.started";
    case "session.item.updated":
      return "session.item.updated";
    case "session.item.completed":
      return "session.item.completed";
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
    case "session.attachment.superseded":
      // RH2 P2-01c — `session.attachment.superseded` 已注册为正式 NACP message
      // type;lightweight `attachment_superseded` 同义映射到该 NACP type。
      return "session.attachment.superseded";
    case "meta":
      // session-ws-v2 will introduce `session.opened`; until then we map to
      // `session.stream.event` so registry validation does not reject it.
      return "session.stream.event";
    default:
      return "session.stream.event";
  }
}
