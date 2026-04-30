import { describe, it, expect } from "vitest";
import {
  SessionStartBodySchema, SessionResumeBodySchema, SessionCancelBodySchema,
  SessionEndBodySchema, SessionStreamAckBodySchema, SessionHeartbeatBodySchema,
  SessionFollowupInputBodySchema, SessionMessagePostBodySchema,
  SESSION_MESSAGE_TYPES, SESSION_BODY_REQUIRED, SESSION_BODY_SCHEMAS,
} from "../src/messages.js";

const TEAM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("Session message schemas", () => {
  it("session.start accepts valid body with initial_input", () => {
    const r = SessionStartBodySchema.parse({
      initial_input: "hello",
      cwd: "/workspace",
      model_id: "@cf/meta/llama-4-scout-17b-16e-instruct",
      reasoning: { effort: "low" },
    });
    expect(r.initial_input).toBe("hello");
    expect(r.reasoning?.effort).toBe("low");
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

  it("session.followup_input accepts RH5 model_id + reasoning + image parts", () => {
    const r = SessionFollowupInputBodySchema.parse({
      text: "describe",
      model_id: "@cf/meta/llama-4-scout-17b-16e-instruct",
      reasoning: { effort: "medium" },
      parts: [
        { kind: "text", text: "describe this" },
        { kind: "image_url", url: `/sessions/s/files/f/content`, mime: "image/png" },
      ],
    });
    expect(r.parts?.[1]?.kind).toBe("image_url");
    expect(r.reasoning?.effort).toBe("medium");
  });

  it("SessionMessagePostBodySchema accepts text, artifact_ref, and image_url", () => {
    const r = SessionMessagePostBodySchema.parse({
      model_id: "@cf/meta/llama-4-scout-17b-16e-instruct",
      reasoning: { effort: "high" },
      parts: [
        { kind: "text", text: "look" },
        { kind: "artifact_ref", artifact_uuid: "file-1", summary: "uploaded image" },
        { kind: "image_url", url: `/sessions/s/files/file-1/content`, mimeType: "image/png" },
      ],
    });
    expect(r.parts).toHaveLength(3);
    expect(r.reasoning?.effort).toBe("high");
  });
});

describe("registries", () => {
  // HP6 P1-02: registry now contains the original 8 (7 initial + followup)
  // plus 7 ZX2 types, RH2 attachment.superseded, HP5 confirmation
  // request/update, and HP6 todos write/update — see
  // test/hp5-confirmation-messages.test.ts and
  // test/hp6-todo-messages.test.ts for detailed coverage.
  it("has 20 session message types (initial 7 + followup + ZX2 7 + RH2 attachment.superseded + HP5 confirmation 2 + HP6 todos 2)", () => {
    expect(SESSION_MESSAGE_TYPES.size).toBe(20);
    expect(SESSION_MESSAGE_TYPES.has("session.followup_input")).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has("session.permission.request")).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has("session.usage.update")).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has("session.attachment.superseded")).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has("session.confirmation.request")).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has("session.confirmation.update")).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has("session.todos.write")).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has("session.todos.update")).toBe(true);
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

// RH2 P2-01c — session.attachment.superseded schema tests.
describe("RH2 P2-01c: session.attachment.superseded", () => {
  it("accepts a valid body", async () => {
    const { SessionAttachmentSupersededBodySchema } = await import("../src/messages.js");
    const body = SessionAttachmentSupersededBodySchema.parse({
      session_uuid: "11111111-1111-4111-8111-111111111111",
      superseded_at: "2026-04-29T09:00:00.000Z",
      reason: "device-conflict",
    });
    expect(body.reason).toBe("device-conflict");
  });

  it("rejects unknown reason", async () => {
    const { SessionAttachmentSupersededBodySchema } = await import("../src/messages.js");
    expect(() =>
      SessionAttachmentSupersededBodySchema.parse({
        session_uuid: "11111111-1111-4111-8111-111111111111",
        superseded_at: "2026-04-29T09:00:00.000Z",
        reason: "rogue",
      }),
    ).toThrow();
  });

  it("requires session_uuid + superseded_at + reason", async () => {
    const { SessionAttachmentSupersededBodySchema } = await import("../src/messages.js");
    expect(() => SessionAttachmentSupersededBodySchema.parse({})).toThrow();
    expect(() =>
      SessionAttachmentSupersededBodySchema.parse({
        session_uuid: "11111111-1111-4111-8111-111111111111",
      }),
    ).toThrow();
  });

  it("registry entries are wired (SESSION_BODY_SCHEMAS + SESSION_MESSAGE_TYPES + SESSION_BODY_REQUIRED)", () => {
    expect(SESSION_BODY_SCHEMAS["session.attachment.superseded" as keyof typeof SESSION_BODY_SCHEMAS]).toBeDefined();
    expect(SESSION_MESSAGE_TYPES.has("session.attachment.superseded")).toBe(true);
    expect(SESSION_BODY_REQUIRED.has("session.attachment.superseded")).toBe(true);
  });
});
