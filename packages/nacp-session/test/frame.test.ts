import { describe, it, expect } from "vitest";
import { NacpSessionFrameSchema, NacpClientFrameSchema, validateSessionMessageType, validateSessionFrame } from "../src/frame.js";
import { NacpSessionError } from "../src/errors.js";

const VALID_HEADER = {
  schema_version: "1.1.0", message_uuid: "11111111-1111-1111-1111-111111111111",
  message_type: "session.start", delivery_kind: "command",
  sent_at: "2026-04-16T00:00:00.000+00:00",
  producer_role: "client", producer_key: "nano-agent.client.cli@v1", priority: "normal",
};
const VALID_AUTHORITY = {
  team_uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", plan_level: "pro",
  stamped_by_key: "nano-agent.platform.ingress@v1", stamped_at: "2026-04-16T00:00:00.000+00:00",
};
const VALID_TRACE = { trace_uuid: "11111111-1111-1111-1111-111111111111", session_uuid: "22222222-2222-2222-2222-222222222222" };
const VALID_SESSION_FRAME = { stream_uuid: "main", stream_seq: 0, delivery_mode: "at-most-once", ack_required: false };

describe("NacpSessionFrameSchema", () => {
  it("accepts valid server frame", () => {
    const r = NacpSessionFrameSchema.parse({
      header: VALID_HEADER, authority: VALID_AUTHORITY, trace: VALID_TRACE,
      session_frame: VALID_SESSION_FRAME, body: {},
    });
    expect(r.session_frame.stream_uuid).toBe("main");
  });
  it("rejects missing session_frame", () => {
    expect(() => NacpSessionFrameSchema.parse({
      header: VALID_HEADER, authority: VALID_AUTHORITY, trace: VALID_TRACE,
    })).toThrow();
  });
});

describe("NacpClientFrameSchema", () => {
  it("accepts client frame without authority", () => {
    const r = NacpClientFrameSchema.parse({ header: VALID_HEADER, trace: VALID_TRACE });
    expect(r.authority).toBeUndefined();
  });
  it("also accepts client frame WITH authority (ingress will reject it)", () => {
    const r = NacpClientFrameSchema.parse({ header: VALID_HEADER, authority: VALID_AUTHORITY, trace: VALID_TRACE });
    expect(r.authority).toBeDefined();
  });
});

describe("validateSessionFrame (R2 fix)", () => {
  it("rejects non-session message_type", () => {
    expect(() => validateSessionFrame({
      header: { ...VALID_HEADER, message_type: "tool.call.request" }, authority: VALID_AUTHORITY, trace: VALID_TRACE,
      session_frame: VALID_SESSION_FRAME, body: {},
    })).toThrow(NacpSessionError);
  });
  it("rejects invalid stream.event body kind", () => {
    expect(() => validateSessionFrame({
      header: { ...VALID_HEADER, message_type: "session.stream.event" }, authority: VALID_AUTHORITY, trace: VALID_TRACE,
      session_frame: VALID_SESSION_FRAME, body: { kind: "not-a-real-kind" },
    })).toThrow(NacpSessionError);
  });
  it("accepts valid session.stream.event", () => {
    const r = validateSessionFrame({
      header: { ...VALID_HEADER, message_type: "session.stream.event", delivery_kind: "event" }, authority: VALID_AUTHORITY, trace: VALID_TRACE,
      session_frame: VALID_SESSION_FRAME, body: { kind: "system.notify", severity: "info", message: "ok" },
    });
    expect(r.header.message_type).toBe("session.stream.event");
  });

  // B9 / 1.3 — session-side (message_type × delivery_kind) matrix
  it("B9 matrix: accepts session.start with delivery_kind=command", () => {
    const r = validateSessionFrame({
      header: { ...VALID_HEADER, message_type: "session.start", delivery_kind: "command" },
      authority: VALID_AUTHORITY, trace: VALID_TRACE,
      session_frame: VALID_SESSION_FRAME, body: { initial_input: "hi" },
    });
    expect(r.header.delivery_kind).toBe("command");
  });

  it("B9 matrix: rejects session.start with delivery_kind=event", () => {
    expect(() => validateSessionFrame({
      header: { ...VALID_HEADER, message_type: "session.start", delivery_kind: "event" },
      authority: VALID_AUTHORITY, trace: VALID_TRACE,
      session_frame: VALID_SESSION_FRAME, body: { initial_input: "hi" },
    })).toThrow(NacpSessionError);
  });

  it("B9 matrix: accepts session.heartbeat with delivery_kind=event", () => {
    const r = validateSessionFrame({
      header: { ...VALID_HEADER, message_type: "session.heartbeat", delivery_kind: "event" },
      authority: VALID_AUTHORITY, trace: VALID_TRACE,
      session_frame: VALID_SESSION_FRAME, body: { ts: Date.now() },
    });
    expect(r.header.delivery_kind).toBe("event");
  });

  it("B9 matrix: rejects session.heartbeat with delivery_kind=command", () => {
    expect(() => validateSessionFrame({
      header: { ...VALID_HEADER, message_type: "session.heartbeat", delivery_kind: "command" },
      authority: VALID_AUTHORITY, trace: VALID_TRACE,
      session_frame: VALID_SESSION_FRAME, body: { ts: Date.now() },
    })).toThrow(NacpSessionError);
  });
  it("accepts valid session.start body", () => {
    const r = validateSessionFrame({
      header: VALID_HEADER, authority: VALID_AUTHORITY, trace: VALID_TRACE,
      session_frame: VALID_SESSION_FRAME, body: { initial_input: "hello" },
    });
    expect(r.header.message_type).toBe("session.start");
  });
});

describe("validateSessionMessageType", () => {
  it("passes for session.start", () => {
    expect(() => validateSessionMessageType("session.start")).not.toThrow();
  });
  it("throws for non-session type", () => {
    expect(() => validateSessionMessageType("tool.call.request")).toThrow(NacpSessionError);
  });
});
