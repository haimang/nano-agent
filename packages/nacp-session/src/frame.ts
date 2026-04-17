/**
 * Session Frame — extends Core NacpEnvelopeBaseSchema with session_frame fields.
 *
 * I2 (Opus review): frame.ts MUST import and extend NacpEnvelopeBaseSchema,
 * not construct a new envelope shape from scratch.
 *
 * Client frames may omit authority (server-stamped rule).
 * Server frames always have full authority + session_frame.
 */

import { z } from "zod";
import {
  NacpEnvelopeBaseSchema,
  NacpHeaderSchema,
  NacpTraceSchema,
  NacpAuthoritySchema,
} from "@nano-agent/nacp-core";
import { SESSION_MESSAGE_TYPES, SESSION_BODY_SCHEMAS, SESSION_BODY_REQUIRED } from "./messages.js";
import { SessionStreamEventBodySchema } from "./stream-event.js";
import { NacpSessionError, SESSION_ERROR_CODES } from "./errors.js";

// ── Session frame extension fields ──

export const SessionFrameFieldsSchema = z.object({
  stream_id: z.string().min(1).max(128),
  stream_seq: z.number().int().min(0),
  last_seen_seq: z.number().int().min(0).optional(),
  replay_from: z.number().int().min(0).optional(),
  delivery_mode: z.enum(["at-most-once", "at-least-once"]).default("at-most-once"),
  ack_required: z.boolean().default(false),
});
export type SessionFrameFields = z.infer<typeof SessionFrameFieldsSchema>;

// ── Full server-side Session frame (authority required) ──

export const NacpSessionFrameSchema = NacpEnvelopeBaseSchema.extend({
  session_frame: SessionFrameFieldsSchema,
});
export type NacpSessionFrame = z.infer<typeof NacpSessionFrameSchema>;

// ── Relaxed client-side frame (authority optional, no session_frame) ──

export const NacpClientFrameSchema = z.object({
  header: NacpHeaderSchema,
  authority: NacpAuthoritySchema.optional(), // client MAY omit
  trace: NacpTraceSchema,
  control: z.unknown().optional(),
  body: z.unknown().optional(),
  refs: z.unknown().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type NacpClientFrame = z.infer<typeof NacpClientFrameSchema>;

// ── Validation helper ──

export function validateSessionMessageType(messageType: string): void {
  if (!SESSION_MESSAGE_TYPES.has(messageType)) {
    throw new NacpSessionError(
      [`message_type '${messageType}' is not a Session profile message`],
      SESSION_ERROR_CODES.NACP_SESSION_INVALID_PHASE,
    );
  }
}

/**
 * Full Session frame validation: message_type + body schema + session_frame.
 * R2 fix: wires SESSION_BODY_SCHEMAS into runtime parse path.
 */
export function validateSessionFrame(raw: unknown): NacpSessionFrame {
  const parsed = NacpSessionFrameSchema.safeParse(raw);
  if (!parsed.success) {
    throw new NacpSessionError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      SESSION_ERROR_CODES.NACP_SESSION_INVALID_PHASE,
    );
  }
  const frame = parsed.data;

  validateSessionMessageType(frame.header.message_type);

  // Enforce SESSION_BODY_REQUIRED (Blocker 1 fix)
  const mt = frame.header.message_type;
  if (SESSION_BODY_REQUIRED.has(mt) && frame.body === undefined) {
    throw new NacpSessionError(
      [`body is required for session message_type '${mt}'`],
      SESSION_ERROR_CODES.NACP_SESSION_INVALID_PHASE,
    );
  }
  // session.stream.event always requires body
  if (mt === "session.stream.event" && frame.body === undefined) {
    throw new NacpSessionError(
      ["body is required for session.stream.event"],
      SESSION_ERROR_CODES.NACP_SESSION_INVALID_PHASE,
    );
  }

  if (frame.header.message_type === "session.stream.event" && frame.body !== undefined) {
    const evtResult = SessionStreamEventBodySchema.safeParse(frame.body);
    if (!evtResult.success) {
      throw new NacpSessionError(
        evtResult.error.issues.map((i) => `body.${i.path.join(".")}: ${i.message}`),
        SESSION_ERROR_CODES.NACP_SESSION_INVALID_PHASE,
      );
    }
  } else {
    const bodySchema = SESSION_BODY_SCHEMAS[frame.header.message_type as keyof typeof SESSION_BODY_SCHEMAS];
    if (bodySchema && frame.body !== undefined) {
      const bodyResult = bodySchema.safeParse(frame.body);
      if (!bodyResult.success) {
        throw new NacpSessionError(
          bodyResult.error.issues.map((i) => `body.${i.path.join(".")}: ${i.message}`),
          SESSION_ERROR_CODES.NACP_SESSION_INVALID_PHASE,
        );
      }
    }
  }

  return frame as NacpSessionFrame;
}
