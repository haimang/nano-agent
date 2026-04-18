/**
 * Ingress — authority stamping + validation for client frames.
 *
 * Client WebSocket frames arrive WITHOUT authority (server-stamped rule).
 * After stamping, the assembled frame is validated via validateSessionFrame().
 *
 * Blocker 1 fix: normalizeClientFrame now calls validateSessionFrame()
 * to enforce message_type, body schema, and SESSION_BODY_REQUIRED.
 */

import type { NacpAuthority } from "@nano-agent/nacp-core";
import { type NacpClientFrame, type NacpSessionFrame, validateSessionFrame } from "./frame.js";
import { NacpSessionError, SESSION_ERROR_CODES } from "./errors.js";
import { SESSION_MESSAGE_TYPES, SESSION_BODY_SCHEMAS } from "./messages.js";
import { SessionStreamEventBodySchema } from "./stream-event.js";

export interface IngressContext {
  team_uuid: string;
  user_uuid?: string;
  plan_level: "free" | "pro" | "enterprise" | "internal";
  membership_level?: "owner" | "admin" | "operator" | "member" | "readonly";
  stamped_by_key: string;
}

export function normalizeClientFrame(
  raw: NacpClientFrame,
  ctx: IngressContext,
  sessionStreamSeq: number,
  streamUuid: string,
): NacpSessionFrame {
  // Reject if client tried to author authority
  if (raw.authority) {
    throw new NacpSessionError(
      ["client frame must NOT include authority — it is server-stamped"],
      SESSION_ERROR_CODES.NACP_SESSION_FORGED_AUTHORITY,
    );
  }

  // Validate message type is Session profile
  if (!SESSION_MESSAGE_TYPES.has(raw.header.message_type)) {
    throw new NacpSessionError(
      [`message_type '${raw.header.message_type}' is not a Session message`],
      SESSION_ERROR_CODES.NACP_SESSION_INVALID_PHASE,
    );
  }

  const authority: NacpAuthority = {
    team_uuid: ctx.team_uuid,
    user_uuid: ctx.user_uuid,
    plan_level: ctx.plan_level,
    membership_level: ctx.membership_level,
    stamped_by_key: ctx.stamped_by_key,
    stamped_at: new Date().toISOString(),
  };

  const assembled = {
    header: raw.header,
    authority,
    trace: raw.trace,
    control: raw.control,
    body: raw.body,
    refs: raw.refs,
    extra: raw.extra,
    session_frame: {
      stream_uuid: streamUuid,
      stream_seq: sessionStreamSeq,
      delivery_mode: "at-most-once",
      ack_required: false,
    },
  };

  // Blocker 1 fix: validate the assembled frame through the full parse path
  return validateSessionFrame(assembled);
}
