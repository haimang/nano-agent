import { describe, it, expect } from "vitest";
import { migrate_noop, migrate_v1_0_to_v1_1 } from "../src/compat/migrations.js";
import { validateEnvelope } from "../src/envelope.js";
import { NACP_VERSION } from "../src/version.js";
import "../src/messages/index.js";

const UUID = "11111111-1111-1111-1111-111111111111";
const TEAM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SENT = "2026-04-16T00:00:00.000+00:00";

function makeLegacyV10Envelope(overrides: Record<string, unknown> = {}) {
  return {
    header: {
      schema_version: "1.0.0",
      message_uuid: UUID,
      message_type: "tool.call.request",
      delivery_kind: "command",
      sent_at: SENT,
      producer_role: "session",
      producer_id: "nano-agent.session.do@v1",
      consumer_hint: "nano-agent.capability.bash@v1",
      priority: "normal",
    },
    authority: {
      team_uuid: TEAM,
      plan_level: "pro",
      stamped_by: "nano-agent.platform.ingress@v1",
      stamped_at: SENT,
    },
    trace: {
      trace_id: UUID,
      session_uuid: UUID,
      stream_id: "stream-a",
      stream_seq: 0,
      span_id: "span-a",
    },
    control: {
      reply_to: UUID,
    },
    body: { tool_name: "bash", tool_input: { command: "ls" } },
    ...overrides,
  };
}

describe("compat/migrations", () => {
  describe("migrate_noop", () => {
    it("passes through input unchanged", () => {
      const input = { header: { message_type: "test" } };
      expect(migrate_noop(input)).toBe(input);
    });

    it("handles null / primitives", () => {
      expect(migrate_noop(null)).toBeNull();
      expect(migrate_noop(42)).toBe(42);
      expect(migrate_noop("x")).toBe("x");
    });
  });

  describe("migrate_v1_0_to_v1_1 — field rename coverage", () => {
    it("rewrites header.producer_id -> header.producer_key", () => {
      const raw = makeLegacyV10Envelope();
      const migrated = migrate_v1_0_to_v1_1(raw) as Record<string, any>;
      expect(migrated.header.producer_key).toBe("nano-agent.session.do@v1");
      expect(migrated.header.producer_id).toBeUndefined();
    });

    it("rewrites header.consumer_hint -> header.consumer_key", () => {
      const raw = makeLegacyV10Envelope();
      const migrated = migrate_v1_0_to_v1_1(raw) as Record<string, any>;
      expect(migrated.header.consumer_key).toBe("nano-agent.capability.bash@v1");
      expect(migrated.header.consumer_hint).toBeUndefined();
    });

    it("rewrites authority.stamped_by -> authority.stamped_by_key", () => {
      const raw = makeLegacyV10Envelope();
      const migrated = migrate_v1_0_to_v1_1(raw) as Record<string, any>;
      expect(migrated.authority.stamped_by_key).toBe("nano-agent.platform.ingress@v1");
      expect(migrated.authority.stamped_by).toBeUndefined();
    });

    it("rewrites trace.trace_id/stream_id/span_id -> *_uuid", () => {
      const raw = makeLegacyV10Envelope();
      const migrated = migrate_v1_0_to_v1_1(raw) as Record<string, any>;
      expect(migrated.trace.trace_uuid).toBe(UUID);
      expect(migrated.trace.stream_uuid).toBe("stream-a");
      expect(migrated.trace.span_uuid).toBe("span-a");
      expect(migrated.trace.trace_id).toBeUndefined();
      expect(migrated.trace.stream_id).toBeUndefined();
      expect(migrated.trace.span_id).toBeUndefined();
    });

    it("rewrites control.reply_to -> control.reply_to_message_uuid", () => {
      const raw = makeLegacyV10Envelope();
      const migrated = migrate_v1_0_to_v1_1(raw) as Record<string, any>;
      expect(migrated.control.reply_to_message_uuid).toBe(UUID);
      expect(migrated.control.reply_to).toBeUndefined();
    });

    it("bumps schema_version from 1.0.x -> 1.1.0", () => {
      const raw = makeLegacyV10Envelope();
      const migrated = migrate_v1_0_to_v1_1(raw) as Record<string, any>;
      expect(migrated.header.schema_version).toBe("1.1.0");
    });

    it("rewrites session_frame.stream_id -> stream_uuid", () => {
      const raw = {
        ...makeLegacyV10Envelope(),
        session_frame: { stream_id: "main", stream_seq: 0 },
      };
      const migrated = migrate_v1_0_to_v1_1(raw) as Record<string, any>;
      expect(migrated.session_frame.stream_uuid).toBe("main");
      expect(migrated.session_frame.stream_id).toBeUndefined();
    });

    it("rewrites session.stream.ack body.stream_id -> body.stream_uuid", () => {
      const raw = {
        header: {
          schema_version: "1.0.0",
          message_uuid: UUID,
          message_type: "session.stream.ack",
          delivery_kind: "command",
          sent_at: SENT,
          producer_role: "client",
          producer_id: "client.web@v1",
          priority: "normal",
        },
        body: { stream_id: "s1", acked_seq: 3 },
      };
      const migrated = migrate_v1_0_to_v1_1(raw) as Record<string, any>;
      expect(migrated.body.stream_uuid).toBe("s1");
      expect(migrated.body.stream_id).toBeUndefined();
    });

    it("returns non-object input unchanged", () => {
      expect(migrate_v1_0_to_v1_1(null)).toBeNull();
      expect(migrate_v1_0_to_v1_1(42)).toBe(42);
      expect(migrate_v1_0_to_v1_1("x")).toBe("x");
    });

    it("canonical wins: keeps the target key when both aliases present", () => {
      const raw = {
        header: {
          schema_version: "1.0.0",
          message_uuid: UUID,
          message_type: "tool.call.request",
          delivery_kind: "command",
          sent_at: SENT,
          producer_role: "session",
          producer_id: "legacy@v1",
          producer_key: "canonical@v1",
          priority: "normal",
        },
      };
      const migrated = migrate_v1_0_to_v1_1(raw) as Record<string, any>;
      expect(migrated.header.producer_key).toBe("canonical@v1");
      expect(migrated.header.producer_id).toBeUndefined();
    });
  });

  describe("validateEnvelope — legacy 1.0 payload acceptance", () => {
    it("accepts a legacy 1.0 payload through the Layer-0 compat shim", () => {
      const legacy = makeLegacyV10Envelope();
      const validated = validateEnvelope(legacy);
      expect(validated.header.schema_version).toBe(NACP_VERSION);
      expect(validated.header.producer_key).toBe("nano-agent.session.do@v1");
      expect(validated.authority.stamped_by_key).toBe("nano-agent.platform.ingress@v1");
      expect(validated.trace.trace_uuid).toBe(UUID);
      expect(validated.trace.stream_uuid).toBe("stream-a");
      expect((validated as any).control.reply_to_message_uuid).toBe(UUID);
    });

    it("does not touch canonical 1.1 payloads (no alias mangle)", () => {
      const current: any = makeLegacyV10Envelope();
      // switch header to the canonical 1.1 shape
      current.header.schema_version = NACP_VERSION;
      current.header.producer_key = current.header.producer_id;
      current.header.consumer_key = current.header.consumer_hint;
      delete current.header.producer_id;
      delete current.header.consumer_hint;
      current.authority.stamped_by_key = current.authority.stamped_by;
      delete current.authority.stamped_by;
      current.trace.trace_uuid = current.trace.trace_id;
      current.trace.stream_uuid = current.trace.stream_id;
      current.trace.span_uuid = current.trace.span_id;
      delete current.trace.trace_id;
      delete current.trace.stream_id;
      delete current.trace.span_id;
      current.control.reply_to_message_uuid = current.control.reply_to;
      delete current.control.reply_to;

      const validated = validateEnvelope(current);
      expect(validated.header.producer_key).toBe("nano-agent.session.do@v1");
    });
  });
});
