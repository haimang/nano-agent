import { describe, it, expect } from "vitest";
import { normalizeClientFrame, type IngressContext } from "../src/ingress.js";
import type { NacpClientFrame } from "../src/frame.js";
import { NacpSessionError, SESSION_ERROR_CODES } from "../src/errors.js";

const CTX: IngressContext = { team_uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", plan_level: "pro", stamped_by_key: "nano-agent.platform.ingress@v1" };
const HEADER = { schema_version: "1.1.0", message_uuid: "11111111-1111-1111-1111-111111111111", message_type: "session.start", delivery_kind: "command" as const, sent_at: "2026-04-16T00:00:00.000+00:00", producer_role: "client" as const, producer_key: "nano-agent.client.cli@v1", priority: "normal" as const };
const TRACE = { trace_uuid: "11111111-1111-1111-1111-111111111111", session_uuid: "22222222-2222-2222-2222-222222222222" };

describe("normalizeClientFrame", () => {
  it("stamps authority from ingress context", () => {
    const frame: NacpClientFrame = { header: HEADER, trace: TRACE, body: { initial_input: "hello" } };
    const result = normalizeClientFrame(frame, CTX, 0, "main");
    expect(result.authority.team_uuid).toBe(CTX.team_uuid);
    expect(result.authority.stamped_by_key).toBe(CTX.stamped_by_key);
    expect(result.session_frame.stream_uuid).toBe("main");
  });

  it("rejects client frame that includes authority (forged)", () => {
    const frame: NacpClientFrame = {
      header: HEADER, trace: TRACE, body: {},
      authority: { team_uuid: "fake", plan_level: "pro", stamped_by_key: "evil@v1", stamped_at: "2026-01-01T00:00:00Z" },
    };
    try { normalizeClientFrame(frame, CTX, 0, "main"); expect.fail("should throw"); }
    catch (e: any) { expect(e.code).toBe(SESSION_ERROR_CODES.NACP_SESSION_FORGED_AUTHORITY); }
  });

  it("rejects non-session message type", () => {
    const frame: NacpClientFrame = { header: { ...HEADER, message_type: "tool.call.request" }, trace: TRACE };
    expect(() => normalizeClientFrame(frame, CTX, 0, "main")).toThrow(NacpSessionError);
  });

  // Blocker 1 path-level tests: normalizeClientFrame now runs validateSessionFrame()

  it("rejects session.start with invalid body type (initial_input must be string)", () => {
    const frame: NacpClientFrame = { header: HEADER, trace: TRACE, body: { initial_input: 123 } };
    expect(() => normalizeClientFrame(frame, CTX, 0, "main")).toThrow(NacpSessionError);
  });

  it("accepts session.start with valid body", () => {
    const frame: NacpClientFrame = { header: HEADER, trace: TRACE, body: { initial_input: "hello" } };
    const result = normalizeClientFrame(frame, CTX, 0, "main");
    expect(result.header.message_type).toBe("session.start");
  });

  it("rejects session.resume without required last_seen_seq", () => {
    const frame: NacpClientFrame = { header: { ...HEADER, message_type: "session.resume" }, trace: TRACE, body: {} };
    expect(() => normalizeClientFrame(frame, CTX, 0, "main")).toThrow(NacpSessionError);
  });

  it("accepts session.resume with valid body", () => {
    const frame: NacpClientFrame = { header: { ...HEADER, message_type: "session.resume" }, trace: TRACE, body: { last_seen_seq: 5 } };
    const result = normalizeClientFrame(frame, CTX, 0, "main");
    expect(result.header.message_type).toBe("session.resume");
  });

  it("accepts session.followup_input with valid body (Phase 0 widened surface)", () => {
    const frame: NacpClientFrame = {
      header: { ...HEADER, message_type: "session.followup_input" },
      trace: TRACE,
      body: { text: "second turn input" },
    };
    const result = normalizeClientFrame(frame, CTX, 1, "main");
    expect(result.header.message_type).toBe("session.followup_input");
    expect((result.body as any).text).toBe("second turn input");
  });

  it("rejects session.followup_input when body.text is missing", () => {
    const frame: NacpClientFrame = {
      header: { ...HEADER, message_type: "session.followup_input" },
      trace: TRACE,
      body: {},
    };
    expect(() => normalizeClientFrame(frame, CTX, 1, "main")).toThrow(NacpSessionError);
  });
});
