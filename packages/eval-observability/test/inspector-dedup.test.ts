/**
 * Tests for B6 SessionInspector dedup (per
 * `docs/rfc/nacp-core-1-2-0.md` §4.2 + binding-F04).
 *
 * Locks:
 *   - Hard dedup by `messageUuid` when provided.
 *   - No dedup when `messageUuid` is absent (backward compat).
 *   - Duplicate events are recorded in `getRejections()` with
 *     `reason: "duplicate-message"`.
 *   - `onSessionFrame(frame)` extracts header + body automatically.
 *   - `getDedupStats()` exposes the counter contract the B7 integrated
 *     spike will read.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SessionInspector } from "../src/inspector.js";

describe("SessionInspector — B6 dedup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hard-dedups repeat messageUuids and drops the duplicates", () => {
    const inspector = new SessionInspector();
    const messageUuid = "77777777-7777-4777-8777-777777777777";

    inspector.onStreamEvent("turn.begin", 1, { turn_uuid: "t-1" }, { messageUuid });
    inspector.onStreamEvent("turn.begin", 2, { turn_uuid: "t-1" }, { messageUuid });
    inspector.onStreamEvent("turn.begin", 3, { turn_uuid: "t-1" }, { messageUuid });

    expect(inspector.getEvents()).toHaveLength(1);
    expect(inspector.getEvents()[0]?.seq).toBe(1);

    const rejections = inspector.getRejections();
    expect(rejections).toHaveLength(2);
    expect(rejections.every((r) => r.reason === "duplicate-message")).toBe(true);
    expect(rejections[0]?.messageUuid).toBe(messageUuid);

    const stats = inspector.getDedupStats();
    expect(stats.dedupEligible).toBe(1);
    expect(stats.duplicatesDropped).toBe(2);
    expect(stats.missingMessageUuid).toBe(0);
  });

  it("does NOT dedup when the caller omits messageUuid (backward compat)", () => {
    const inspector = new SessionInspector();

    inspector.onStreamEvent("turn.begin", 1, { turn_uuid: "t-1" });
    inspector.onStreamEvent("turn.begin", 2, { turn_uuid: "t-1" });

    expect(inspector.getEvents()).toHaveLength(2);
    expect(inspector.getRejections()).toHaveLength(0);

    const stats = inspector.getDedupStats();
    expect(stats.dedupEligible).toBe(0);
    expect(stats.duplicatesDropped).toBe(0);
    expect(stats.missingMessageUuid).toBe(2);
  });

  it("mixed population: eligible events dedup, missing-uuid events pass through", () => {
    const inspector = new SessionInspector();
    const uuidA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    inspector.onStreamEvent("turn.begin", 1, {}, { messageUuid: uuidA });
    inspector.onStreamEvent("llm.delta", 2, { content: "x", content_type: "text", is_final: false });
    inspector.onStreamEvent("turn.begin", 3, {}, { messageUuid: uuidA }); // dup
    inspector.onStreamEvent("turn.end", 4, {});

    expect(inspector.getEvents()).toHaveLength(3); // 1 + 2 + 4
    expect(inspector.getRejections()).toHaveLength(1);

    const stats = inspector.getDedupStats();
    expect(stats.dedupEligible).toBe(1);
    expect(stats.duplicatesDropped).toBe(1);
    expect(stats.missingMessageUuid).toBe(2);
  });

  it("empty-string messageUuid is treated as absent (not eligible for dedup)", () => {
    const inspector = new SessionInspector();

    inspector.onStreamEvent("turn.begin", 1, {}, { messageUuid: "" });
    inspector.onStreamEvent("turn.begin", 2, {}, { messageUuid: "" });

    expect(inspector.getEvents()).toHaveLength(2);
    const stats = inspector.getDedupStats();
    expect(stats.missingMessageUuid).toBe(2);
    expect(stats.dedupEligible).toBe(0);
  });

  it("records messageUuid on the stored InspectorEvent", () => {
    const inspector = new SessionInspector();
    const uuid = "55555555-5555-4555-8555-555555555555";

    inspector.onStreamEvent("turn.begin", 1, { turn_uuid: "t-1" }, { messageUuid: uuid });

    const event = inspector.getEvents()[0];
    expect(event?.messageUuid).toBe(uuid);
  });

  it("rejections preserve messageUuid for unknown-kind as well", () => {
    const inspector = new SessionInspector();
    const uuid = "11111111-1111-4111-8111-111111111111";

    inspector.onStreamEvent("unknown.kind", 42, { foo: "bar" }, { messageUuid: uuid });

    const rejections = inspector.getRejections();
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.reason).toBe("unknown-kind");
    expect(rejections[0]?.messageUuid).toBe(uuid);
  });

  it("body-validator rejections coexist with dedup without poisoning the seen-set", () => {
    // A handler that rejects events with empty bodies.
    const validator = (cand: { kind: string } & Record<string, unknown>) => {
      if (cand.kind === "turn.begin" && !("turn_uuid" in cand)) {
        return { ok: false, reason: "missing turn_uuid" } as const;
      }
      return { ok: true } as const;
    };
    const inspector = new SessionInspector(validator);
    const uuid = "88888888-8888-4888-8888-888888888888";

    // First call: invalid body → rejected BEFORE dedup runs. The uuid
    // must NOT be marked as seen.
    inspector.onStreamEvent("turn.begin", 1, {}, { messageUuid: uuid });
    // Second call: valid body, same uuid. Should be accepted because
    // the uuid was never added on the first pass.
    inspector.onStreamEvent(
      "turn.begin",
      2,
      { turn_uuid: "t-1" },
      { messageUuid: uuid },
    );

    expect(inspector.getEvents()).toHaveLength(1);
    expect(inspector.getEvents()[0]?.seq).toBe(2);
    expect(inspector.getRejections()).toHaveLength(1);
    expect(inspector.getRejections()[0]?.reason).toBe("invalid-body");
  });
});

describe("SessionInspector — B6 onSessionFrame", () => {
  it("extracts header.message_uuid + body + session_frame.stream_seq", () => {
    const inspector = new SessionInspector();
    inspector.onSessionFrame({
      header: { message_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      body: { kind: "turn.begin", turn_uuid: "t-1" },
      session_frame: { stream_uuid: "main", stream_seq: 7 },
    });

    const events = inspector.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("turn.begin");
    expect(events[0]?.seq).toBe(7);
    expect(events[0]?.messageUuid).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("triplicated frames with identical header.message_uuid collapse to one event", () => {
    const inspector = new SessionInspector();
    const frame = {
      header: { message_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      body: { kind: "llm.delta", content_type: "text", content: "hi", is_final: false },
      session_frame: { stream_uuid: "main", stream_seq: 1 },
    };
    inspector.onSessionFrame(frame);
    inspector.onSessionFrame(frame);
    inspector.onSessionFrame(frame);

    expect(inspector.getEvents()).toHaveLength(1);
    const stats = inspector.getDedupStats();
    expect(stats.duplicatesDropped).toBe(2);
  });

  it("falls back to seq=0 when session_frame is absent", () => {
    const inspector = new SessionInspector();
    inspector.onSessionFrame({
      header: { message_uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      body: { kind: "turn.begin", turn_uuid: "t-1" },
    });
    expect(inspector.getEvents()[0]?.seq).toBe(0);
  });

  it("rejects frames whose body has no canonical `kind`", () => {
    const inspector = new SessionInspector();
    inspector.onSessionFrame({
      header: { message_uuid: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      body: { not_a_kind: true },
      session_frame: { stream_uuid: "main", stream_seq: 1 },
    });
    expect(inspector.getEvents()).toHaveLength(0);
    expect(inspector.getRejections()).toHaveLength(1);
    expect(inspector.getRejections()[0]?.reason).toBe("unknown-kind");
  });

  it("does NOT dedup a frame that omits header.message_uuid", () => {
    const inspector = new SessionInspector();
    const frame = {
      body: { kind: "turn.end", turn_uuid: "t-1" },
      session_frame: { stream_uuid: "main", stream_seq: 1 },
    };
    inspector.onSessionFrame(frame);
    inspector.onSessionFrame(frame);
    expect(inspector.getEvents()).toHaveLength(2);
  });
});
