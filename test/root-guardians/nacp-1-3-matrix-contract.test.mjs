import test from "node:test";
import assert from "node:assert/strict";

import {
  NACP_CORE_TYPE_DIRECTION_MATRIX,
  NACP_MESSAGE_TYPES_ALL,
  validateEnvelope,
  wrapAsError,
  NacpErrorBodySchema,
  NACP_ERROR_BODY_VERBS,
  NACP_VERSION,
} from "../../packages/nacp-core/dist/index.js";

import {
  NACP_SESSION_TYPE_DIRECTION_MATRIX,
  SESSION_MESSAGE_TYPES,
  validateSessionFrame,
  NACP_SESSION_VERSION,
} from "../../packages/nacp-session/dist/index.js";

// B9 root contract — NACP 1.3 double-matrix ownership.
// See docs/rfc/nacp-core-1-3-draft.md and
// docs/action-plan/after-foundations/B9-nacp-1-3-contract-freeze.md §4.4 P4-01.

const UUID = "11111111-1111-1111-1111-111111111111";
const TEAM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SENT = "2026-04-21T00:00:00.000+00:00";

test("B9 §2.1 — core matrix covers every core-registered type", () => {
  for (const type of NACP_MESSAGE_TYPES_ALL) {
    assert.ok(
      NACP_CORE_TYPE_DIRECTION_MATRIX[type],
      `core type '${type}' missing from NACP_CORE_TYPE_DIRECTION_MATRIX`,
    );
    const allowed = NACP_CORE_TYPE_DIRECTION_MATRIX[type];
    assert.ok(
      allowed && allowed.size > 0,
      `core type '${type}' has empty legal delivery_kind set`,
    );
  }
});

test("B9 §2.2 — session matrix covers every session-registered type", () => {
  for (const type of SESSION_MESSAGE_TYPES) {
    assert.ok(
      NACP_SESSION_TYPE_DIRECTION_MATRIX[type],
      `session type '${type}' missing from NACP_SESSION_TYPE_DIRECTION_MATRIX`,
    );
    const allowed = NACP_SESSION_TYPE_DIRECTION_MATRIX[type];
    assert.ok(
      allowed && allowed.size > 0,
      `session type '${type}' has empty legal delivery_kind set`,
    );
  }
});

test("B9 §2.3 — validateEnvelope() rejects illegal core combination", () => {
  const env = {
    header: {
      schema_version: NACP_VERSION,
      message_uuid: UUID,
      message_type: "tool.call.request",
      delivery_kind: "event", // ILLEGAL — should be `command`
      sent_at: SENT,
      producer_role: "session",
      producer_key: "nano-agent.session.do@v1",
      priority: "normal",
    },
    authority: {
      team_uuid: TEAM,
      plan_level: "pro",
      stamped_by_key: "nano-agent.platform.ingress@v1",
      stamped_at: SENT,
    },
    trace: { trace_uuid: UUID, session_uuid: UUID },
    body: { tool_name: "bash", tool_input: { command: "ls" } },
  };
  assert.throws(() => validateEnvelope(env), (err) => {
    return err && err.code === "NACP_TYPE_DIRECTION_MISMATCH";
  });
});

test("B9 §2.3 — validateSessionFrame() rejects illegal session combination", () => {
  const frame = {
    header: {
      schema_version: NACP_VERSION,
      message_uuid: UUID,
      message_type: "session.start",
      delivery_kind: "event", // ILLEGAL — should be `command`
      sent_at: SENT,
      producer_role: "client",
      producer_key: "nano-agent.client.cli@v1",
      priority: "normal",
    },
    authority: {
      team_uuid: TEAM,
      plan_level: "pro",
      stamped_by_key: "nano-agent.platform.ingress@v1",
      stamped_at: SENT,
    },
    trace: { trace_uuid: UUID, session_uuid: UUID },
    session_frame: {
      stream_uuid: "main",
      stream_seq: 0,
      delivery_mode: "at-most-once",
      ack_required: false,
    },
    body: { initial_input: "hi" },
  };
  assert.throws(() => validateSessionFrame(frame), (err) => {
    return err && err.code === "NACP_SESSION_TYPE_DIRECTION_MISMATCH";
  });
});

test("B9 §3 — NacpErrorBodySchema + wrapAsError produce a parseable error envelope", () => {
  const source = {
    header: {
      schema_version: NACP_VERSION,
      message_uuid: UUID,
      message_type: "tool.call.request",
      delivery_kind: "command",
      sent_at: SENT,
      producer_role: "session",
      producer_key: "nano-agent.session.do@v1",
      priority: "normal",
    },
    authority: {
      team_uuid: TEAM,
      plan_level: "pro",
      stamped_by_key: "nano-agent.platform.ingress@v1",
      stamped_at: SENT,
    },
    trace: { trace_uuid: UUID, session_uuid: UUID },
    body: { tool_name: "bash", tool_input: {} },
  };

  const wrapped = wrapAsError(
    source,
    { code: "FAIL", message: "nope", retriable: false },
    { message_uuid: "22222222-2222-2222-2222-222222222222", sent_at: SENT },
  );
  assert.equal(wrapped.header.delivery_kind, "error");
  assert.deepEqual(NacpErrorBodySchema.parse(wrapped.body), {
    code: "FAIL",
    message: "nope",
    retriable: false,
  });
});

test("W0 — nacp-core bumps to 1.4.0 while nacp-session stays on 1.3.0", () => {
  assert.equal(NACP_VERSION, "1.4.0");
  assert.equal(NACP_SESSION_VERSION, "1.3.0");
});

// ─────────────────────────────────────────────────────────────────────────
// B9-R2 follow-up — provisional wrapAsError reality
// ─────────────────────────────────────────────────────────────────────────

test("B9-R2 fix — NACP_ERROR_BODY_VERBS is empty at B9 (per RFC §3.2)", () => {
  // This is meta-documentation for the per-verb migration PR: the registry
  // is intentionally empty at B9 and must stay empty until a verb formally
  // adopts NacpErrorBodySchema as its body schema.
  assert.equal(NACP_ERROR_BODY_VERBS.size, 0);
});

test("B9-R2 fix — wrapAsError output is NOT yet a valid envelope under 1.3 surface", () => {
  // Regression guard for GPT-R2: the helper is provisional. Today, wrapping
  // any shipped request/response verb produces an envelope that
  // validateEnvelope() correctly rejects — because either the matrix
  // disallows delivery_kind="error" for that type, or the body schema is
  // still `{status, error?}` and will fail body validation against
  // NacpErrorBodySchema. This test locks the current (honest) reality so
  // the closure language stays aligned with shipped behavior.
  const source = {
    header: {
      schema_version: NACP_VERSION,
      message_uuid: UUID,
      message_type: "tool.call.request",
      delivery_kind: "command",
      sent_at: SENT,
      producer_role: "session",
      producer_key: "nano-agent.session.do@v1",
      priority: "normal",
    },
    authority: {
      team_uuid: TEAM,
      plan_level: "pro",
      stamped_by_key: "nano-agent.platform.ingress@v1",
      stamped_at: SENT,
    },
    trace: { trace_uuid: UUID, session_uuid: UUID },
    body: { tool_name: "bash", tool_input: {} },
  };
  const wrapped = wrapAsError(
    source,
    { code: "X", message: "y" },
    { message_uuid: "22222222-2222-2222-2222-222222222222", sent_at: SENT },
  );
  // Provisional: this helper does not yet produce a valid 1.3 envelope.
  assert.throws(() => validateEnvelope(wrapped));
});

test("B9-R2 fix — wrapAsError honors target_message_type override", () => {
  const source = {
    header: {
      schema_version: NACP_VERSION,
      message_uuid: UUID,
      message_type: "tool.call.request",
      delivery_kind: "command",
      sent_at: SENT,
      producer_role: "session",
      producer_key: "nano-agent.session.do@v1",
      priority: "normal",
    },
    authority: {
      team_uuid: TEAM,
      plan_level: "pro",
      stamped_by_key: "nano-agent.platform.ingress@v1",
      stamped_at: SENT,
    },
    trace: { trace_uuid: UUID, session_uuid: UUID },
    body: { tool_name: "bash", tool_input: {} },
  };
  const wrapped = wrapAsError(
    source,
    { code: "X", message: "y" },
    {
      message_uuid: "33333333-3333-3333-3333-333333333333",
      sent_at: SENT,
      target_message_type: "tool.call.response",
    },
  );
  assert.equal(wrapped.header.message_type, "tool.call.response");
  assert.equal(wrapped.header.delivery_kind, "error");
});
