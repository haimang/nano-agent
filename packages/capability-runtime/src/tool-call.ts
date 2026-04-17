/**
 * Tool Call Bridge
 *
 * Bridges between the capability runtime and the nacp-core tool.call.*
 * protocol. Converts CapabilityPlans to tool call request bodies and parses
 * tool call response bodies back into CapabilityResults.
 *
 * This module ONLY produces / consumes the message BODIES. Envelope framing
 * (method, ids, producer role) is the concern of the nacp-core transport
 * layer, not this bridge. Shapes match `packages/nacp-core/src/messages/tool.ts`:
 *
 *   ToolCallRequestBodySchema  = { tool_name: string, tool_input: record }
 *   ToolCallResponseBodySchema = { status: "ok"|"error", output?, error? }
 *   ToolCallCancelBodySchema   = { reason?: string }
 */

import type { CapabilityPlan } from "./types.js";
import type { CapabilityResult } from "./result.js";

/** Shape of a tool.call.request body (matches NACP schema). */
export interface ToolCallRequestBody {
  readonly tool_name: string;
  readonly tool_input: Record<string, unknown>;
}

/** Shape of a tool.call.response body (matches NACP schema). */
export interface ToolCallResponseBody {
  readonly status: "ok" | "error";
  readonly output?: string;
  readonly error?: { readonly code: string; readonly message: string };
}

/** Shape of a tool.call.cancel body (matches NACP schema). */
export interface ToolCallCancelBody {
  readonly reason?: string;
}

/**
 * Wrap non-object inputs into `{ value: ... }` so the result always
 * conforms to `Record<string, unknown>` (required by the NACP schema).
 *
 * Arrays, primitives, null, and undefined all get wrapped. Plain objects
 * pass through unchanged.
 */
function toInputRecord(input: unknown): Record<string, unknown> {
  if (
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input)
  ) {
    return input as Record<string, unknown>;
  }
  return { value: input };
}

/**
 * Byte length of a string when encoded as UTF-8.
 */
function byteLength(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  return new TextEncoder().encode(s).byteLength;
}

/**
 * Build a tool.call.request body from a CapabilityPlan.
 *
 * Returns ONLY the body — not the envelope. The caller is responsible
 * for wrapping this in a framed NACP message.
 */
export function buildToolCallRequest(plan: CapabilityPlan): ToolCallRequestBody {
  return {
    tool_name: plan.capabilityName,
    tool_input: toInputRecord(plan.input),
  };
}

/**
 * Build a tool.call.cancel body.
 *
 * @param reason Optional human-readable reason (max 256 chars per schema).
 */
export function buildToolCallCancelBody(reason?: string): ToolCallCancelBody {
  if (reason === undefined) {
    return {};
  }
  return { reason };
}

/**
 * Parse a tool.call.response body into a CapabilityResult.
 *
 * Expects the NACP-conformant shape:
 *   { status: "ok" | "error", output?: string, error?: { code, message } }
 *
 * Returns an error CapabilityResult if the body cannot be parsed.
 * Note: the returned `capabilityName` is "unknown" and `requestId` is
 * synthesised — the transport layer is expected to supply those from the
 * envelope when composing the final record.
 */
export function parseToolCallResponse(body: unknown): CapabilityResult {
  if (body === null || body === undefined || typeof body !== "object") {
    return {
      kind: "error",
      capabilityName: "unknown",
      requestId: `req-${Date.now()}-parse`,
      error: {
        code: "invalid-response",
        message: "Tool call response body is not an object",
      },
      durationMs: 0,
    };
  }

  const obj = body as Record<string, unknown>;
  const status = obj["status"];

  if (status !== "ok" && status !== "error") {
    return {
      kind: "error",
      capabilityName: "unknown",
      requestId: `req-${Date.now()}-parse`,
      error: {
        code: "invalid-response",
        message: 'Tool call response missing valid "status" ("ok"|"error")',
      },
      durationMs: 0,
    };
  }

  if (status === "error") {
    const rawErr = obj["error"];
    const err = (rawErr && typeof rawErr === "object"
      ? (rawErr as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    return {
      kind: "error",
      capabilityName: "unknown",
      requestId: `req-${Date.now()}-parse`,
      error: {
        code: typeof err["code"] === "string" ? (err["code"] as string) : "unknown-error",
        message:
          typeof err["message"] === "string"
            ? (err["message"] as string)
            : "tool call failed",
      },
      durationMs: 0,
    };
  }

  // status === "ok"
  const output = typeof obj["output"] === "string" ? (obj["output"] as string) : undefined;
  return {
    kind: "inline",
    capabilityName: "unknown",
    requestId: `req-${Date.now()}-parse`,
    output,
    outputSizeBytes: byteLength(output),
    durationMs: 0,
  };
}
