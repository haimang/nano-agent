/**
 * Tests for SessionInspector.
 *
 * Covers:
 *  - Canonical 9-kind catalog enforcement (unknown kinds are rejected).
 *  - Optional body validator plug-in (e.g. `SessionStreamEventBodySchema.safeParse`).
 *  - `filterByKind` / `getLatest` preserve `seq` and `timestamp`.
 *  - Catalog drift guard: the local 9-kind catalog stays aligned with
 *    `@nano-agent/nacp-session`'s `STREAM_EVENT_KINDS`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Import directly from the sibling workspace package sources to guard against
// drift between the inspector's local 9-kind catalog and nacp-session truth.
import { STREAM_EVENT_KINDS } from "../../nacp-session/src/stream-event.js";
import {
  SessionInspector,
  SESSION_STREAM_EVENT_KINDS,
  isSessionStreamEventKind,
} from "../src/inspector.js";

describe("SessionInspector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("catalog alignment", () => {
    it("mirrors the 9 canonical kinds exported by @nano-agent/nacp-session", () => {
      const mine = [...SESSION_STREAM_EVENT_KINDS].sort();
      const theirs = [...STREAM_EVENT_KINDS].sort();
      expect(mine).toEqual(theirs);
    });

    it("isSessionStreamEventKind recognises every canonical kind", () => {
      for (const kind of SESSION_STREAM_EVENT_KINDS) {
        expect(isSessionStreamEventKind(kind)).toBe(true);
      }
    });

    it("isSessionStreamEventKind rejects unknown kinds", () => {
      expect(isSessionStreamEventKind("unknown.kind")).toBe(false);
      expect(isSessionStreamEventKind("turn.start")).toBe(false);
      expect(isSessionStreamEventKind("")).toBe(false);
    });
  });

  describe("onStreamEvent", () => {
    it("records a canonical event with auto-generated timestamp", () => {
      const inspector = new SessionInspector();
      inspector.onStreamEvent("turn.begin", 1, { turn_uuid: "11111111-1111-4111-8111-111111111111" });

      const events = inspector.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe("turn.begin");
      expect(events[0].seq).toBe(1);
      expect(events[0].body).toEqual({ turn_uuid: "11111111-1111-4111-8111-111111111111" });
      expect(events[0].timestamp).toBe("2026-04-16T12:00:00.000Z");
    });

    it("records multiple canonical events in order", () => {
      const inspector = new SessionInspector();
      inspector.onStreamEvent("turn.begin", 1, {});
      vi.setSystemTime(new Date("2026-04-16T12:00:01.000Z"));
      inspector.onStreamEvent("llm.delta", 2, { content: "hi", content_type: "text", is_final: false });
      vi.setSystemTime(new Date("2026-04-16T12:00:02.000Z"));
      inspector.onStreamEvent("turn.end", 3, {});

      const events = inspector.getEvents();
      expect(events).toHaveLength(3);
      expect(events[0].seq).toBe(1);
      expect(events[1].seq).toBe(2);
      expect(events[2].seq).toBe(3);
    });

    it("rejects an unknown kind and reports it in getRejections()", () => {
      const inspector = new SessionInspector();
      inspector.onStreamEvent("unknown.kind", 42, { foo: "bar" });

      expect(inspector.getEvents()).toHaveLength(0);
      const rejections = inspector.getRejections();
      expect(rejections).toHaveLength(1);
      expect(rejections[0].kind).toBe("unknown.kind");
      expect(rejections[0].seq).toBe(42);
      expect(rejections[0].reason).toBe("unknown-kind");
    });

    it("uses bodyValidator when provided and rejects invalid bodies", () => {
      const validator = (cand: { kind: string } & Record<string, unknown>) => {
        if (cand.kind === "turn.begin" && typeof cand.turn_uuid !== "string") {
          return { ok: false, reason: "turn_uuid required" } as const;
        }
        return { ok: true } as const;
      };

      const inspector = new SessionInspector(validator);
      inspector.onStreamEvent("turn.begin", 1, {}); // invalid — missing turn_uuid
      inspector.onStreamEvent("turn.begin", 2, { turn_uuid: "abc" }); // valid

      expect(inspector.getEvents()).toHaveLength(1);
      expect(inspector.getEvents()[0].seq).toBe(2);
      const rejections = inspector.getRejections();
      expect(rejections).toHaveLength(1);
      expect(rejections[0].reason).toBe("invalid-body");
    });
  });

  describe("getEvents", () => {
    it("returns an empty array when no events recorded", () => {
      const inspector = new SessionInspector();
      expect(inspector.getEvents()).toEqual([]);
    });

    it("returns a copy (not a reference)", () => {
      const inspector = new SessionInspector();
      inspector.onStreamEvent("turn.begin", 1, {});

      const events = inspector.getEvents();
      events.push({ kind: "turn.end", seq: 99, timestamp: "", body: null });
      expect(inspector.getEvents()).toHaveLength(1);
    });
  });

  describe("filterByKind", () => {
    it("returns only events matching the given kind, preserving seq and timestamp", () => {
      const inspector = new SessionInspector();
      inspector.onStreamEvent("turn.begin", 1, {});
      vi.setSystemTime(new Date("2026-04-16T12:00:01.000Z"));
      inspector.onStreamEvent("llm.delta", 2, { content: "a", content_type: "text", is_final: false });
      vi.setSystemTime(new Date("2026-04-16T12:00:02.000Z"));
      inspector.onStreamEvent("turn.end", 3, {});
      vi.setSystemTime(new Date("2026-04-16T12:00:03.000Z"));
      inspector.onStreamEvent("llm.delta", 4, { content: "b", content_type: "text", is_final: true });

      const deltas = inspector.filterByKind("llm.delta");
      expect(deltas).toHaveLength(2);
      expect(deltas.every((e) => e.kind === "llm.delta")).toBe(true);
      expect(deltas[0].seq).toBe(2);
      expect(deltas[0].timestamp).toBe("2026-04-16T12:00:01.000Z");
      expect(deltas[1].seq).toBe(4);
      expect(deltas[1].timestamp).toBe("2026-04-16T12:00:03.000Z");
    });

    it("returns empty array when no match", () => {
      const inspector = new SessionInspector();
      inspector.onStreamEvent("turn.begin", 1, {});

      expect(inspector.filterByKind("llm.delta")).toEqual([]);
    });
  });

  describe("getLatest", () => {
    it("returns the last N events, preserving seq and timestamp", () => {
      const inspector = new SessionInspector();
      for (let i = 1; i <= 20; i++) {
        vi.setSystemTime(new Date(`2026-04-16T12:00:${String(i).padStart(2, "0")}.000Z`));
        // Cycle through canonical kinds so every event is accepted.
        const kind = SESSION_STREAM_EVENT_KINDS[i % SESSION_STREAM_EVENT_KINDS.length];
        inspector.onStreamEvent(kind, i, {});
      }

      const latest5 = inspector.getLatest(5);
      expect(latest5).toHaveLength(5);
      expect(latest5[0].seq).toBe(16);
      expect(latest5[4].seq).toBe(20);
      expect(typeof latest5[0].timestamp).toBe("string");
    });

    it("defaults to 10 when n is not specified", () => {
      const inspector = new SessionInspector();
      for (let i = 1; i <= 20; i++) {
        inspector.onStreamEvent(SESSION_STREAM_EVENT_KINDS[i % SESSION_STREAM_EVENT_KINDS.length], i, {});
      }

      const latest = inspector.getLatest();
      expect(latest).toHaveLength(10);
      expect(latest[0].seq).toBe(11);
    });

    it("returns all events when fewer than N exist", () => {
      const inspector = new SessionInspector();
      inspector.onStreamEvent("turn.begin", 1, {});
      inspector.onStreamEvent("turn.end", 2, {});

      const latest = inspector.getLatest(10);
      expect(latest).toHaveLength(2);
    });
  });
});
