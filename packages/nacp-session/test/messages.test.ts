import { describe, it, expect } from "vitest";
import {
  SessionStartBodySchema, SessionResumeBodySchema, SessionCancelBodySchema,
  SessionEndBodySchema, SessionStreamAckBodySchema, SessionHeartbeatBodySchema,
  SessionFollowupInputBodySchema,
  SESSION_MESSAGE_TYPES, SESSION_BODY_REQUIRED, SESSION_BODY_SCHEMAS,
} from "../src/messages.js";

const TEAM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("Session message schemas", () => {
  it("session.start accepts valid body with initial_input", () => {
    const r = SessionStartBodySchema.parse({ initial_input: "hello", cwd: "/workspace" });
    expect(r.initial_input).toBe("hello");
  });
  it("session.start accepts empty body", () => {
    expect(SessionStartBodySchema.parse({})).toBeDefined();
  });
  it("session.resume requires last_seen_seq", () => {
    expect(() => SessionResumeBodySchema.parse({})).toThrow();
    expect(SessionResumeBodySchema.parse({ last_seen_seq: 5 }).last_seen_seq).toBe(5);
  });
  it("session.cancel accepts empty", () => {
    expect(SessionCancelBodySchema.parse({})).toBeDefined();
  });
  it("session.end requires reason enum", () => {
    expect(() => SessionEndBodySchema.parse({})).toThrow();
    expect(SessionEndBodySchema.parse({ reason: "completed" }).reason).toBe("completed");
    expect(() => SessionEndBodySchema.parse({ reason: "invalid" })).toThrow();
  });
  it("session.stream.ack requires stream_uuid + acked_seq", () => {
    expect(() => SessionStreamAckBodySchema.parse({})).toThrow();
    const r = SessionStreamAckBodySchema.parse({ stream_uuid: "s1", acked_seq: 10 });
    expect(r.acked_seq).toBe(10);
    expect(r.stream_uuid).toBe("s1");
  });
  it("session.heartbeat requires ts", () => {
    expect(SessionHeartbeatBodySchema.parse({ ts: Date.now() })).toBeDefined();
  });

  // Phase 0 widened surface (Q1 + Q8)
  it("session.followup_input requires text", () => {
    expect(() => SessionFollowupInputBodySchema.parse({})).toThrow();
    const r = SessionFollowupInputBodySchema.parse({ text: "second turn" });
    expect(r.text).toBe("second turn");
  });
  it("session.followup_input rejects empty text", () => {
    expect(() => SessionFollowupInputBodySchema.parse({ text: "" })).toThrow();
  });
  it("session.followup_input accepts optional context_ref + stream_seq", () => {
    const r = SessionFollowupInputBodySchema.parse({
      text: "more",
      stream_seq: 3,
      context_ref: {
        kind: "r2",
        binding: "R2_WORKSPACE",
        team_uuid: TEAM,
        key: `tenants/${TEAM}/sessions/s/attach/x.json`,
        role: "input",
      },
    });
    expect(r.stream_seq).toBe(3);
    expect(r.context_ref?.kind).toBe("r2");
  });
});

describe("registries", () => {
  // ZX2 Phase 2 P2-03: registry now contains the original 8 (7 initial +
  // followup) plus 7 new ZX2 types — see test/zx2-messages.test.ts for
  // detailed coverage of the new families.
  it("has 15 session message types (initial 7 + followup + ZX2 7-family)", () => {
    expect(SESSION_MESSAGE_TYPES.size).toBe(15);
    expect(SESSION_MESSAGE_TYPES.has("session.followup_input")).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has("session.permission.request")).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has("session.usage.update")).toBe(true);
  });
  it("body required set excludes cancel but includes followup", () => {
    expect(SESSION_BODY_REQUIRED.has("session.cancel")).toBe(false);
    expect(SESSION_BODY_REQUIRED.has("session.start")).toBe(true);
    expect(SESSION_BODY_REQUIRED.has("session.followup_input")).toBe(true);
  });
  it("SESSION_BODY_SCHEMAS exposes the followup body schema", () => {
    expect(SESSION_BODY_SCHEMAS["session.followup_input"]).toBeDefined();
  });
});
