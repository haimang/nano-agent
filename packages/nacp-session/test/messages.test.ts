import { describe, it, expect } from "vitest";
import {
  SessionStartBodySchema, SessionResumeBodySchema, SessionCancelBodySchema,
  SessionEndBodySchema, SessionStreamAckBodySchema, SessionHeartbeatBodySchema,
  SESSION_MESSAGE_TYPES, SESSION_BODY_REQUIRED,
} from "../src/messages.js";

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
  it("session.stream.ack requires stream_id + acked_seq", () => {
    expect(() => SessionStreamAckBodySchema.parse({})).toThrow();
    const r = SessionStreamAckBodySchema.parse({ stream_id: "s1", acked_seq: 10 });
    expect(r.acked_seq).toBe(10);
  });
  it("session.heartbeat requires ts", () => {
    expect(SessionHeartbeatBodySchema.parse({ ts: Date.now() })).toBeDefined();
  });
});

describe("registries", () => {
  it("has 7 session message types", () => {
    expect(SESSION_MESSAGE_TYPES.size).toBe(7);
  });
  it("body required set excludes cancel", () => {
    expect(SESSION_BODY_REQUIRED.has("session.cancel")).toBe(false);
    expect(SESSION_BODY_REQUIRED.has("session.start")).toBe(true);
  });
});
