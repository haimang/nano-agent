/**
 * Tests for `BoundedEvalSink` — the B6 dedup + overflow-disclosure
 * upgrade to `NanoSessionDO.defaultEvalRecords`.
 *
 * Locks:
 *   - Hard dedup on `messageUuid` when provided.
 *   - No dedup when absent (backward compat).
 *   - Capacity overflow evicts FIFO but is NOT silent — each eviction
 *     records a disclosure with `reason: "capacity-exceeded"` and the
 *     optional `onOverflow` callback fires.
 *   - Stats expose `capacityOverflowCount`, `duplicateDropCount`,
 *     `totalOverflowCount`.
 *   - `extractMessageUuid()` works on the three record shapes used by
 *     the default sink.
 */

import { describe, it, expect, vi } from "vitest";
import {
  BoundedEvalSink,
  extractMessageUuid,
  type EvalSinkOverflowDisclosure,
} from "../src/eval-sink.js";

describe("BoundedEvalSink — dedup", () => {
  it("records unique messageUuids and dedups repeats", () => {
    const sink = new BoundedEvalSink();
    const uuid = "77777777-7777-4777-8777-777777777777";

    expect(sink.emit({ record: { v: 1 }, messageUuid: uuid })).toBe(true);
    expect(sink.emit({ record: { v: 2 }, messageUuid: uuid })).toBe(false);
    expect(sink.emit({ record: { v: 3 }, messageUuid: uuid })).toBe(false);

    expect(sink.getRecords()).toEqual([{ v: 1 }]);

    const stats = sink.getStats();
    expect(stats.dedupEligible).toBe(1);
    expect(stats.duplicateDropCount).toBe(2);
    expect(stats.capacityOverflowCount).toBe(0);
    expect(stats.totalOverflowCount).toBe(2);
  });

  it("records without messageUuid pass through unconditionally (backward compat)", () => {
    const sink = new BoundedEvalSink();
    sink.emit({ record: { v: 1 } });
    sink.emit({ record: { v: 1 } });
    sink.emit({ record: { v: 1 } });

    expect(sink.getRecords()).toHaveLength(3);
    expect(sink.getStats().missingMessageUuid).toBe(3);
    expect(sink.getStats().duplicateDropCount).toBe(0);
  });

  it("mixed population: eligible records dedup, absent-uuid records pass through", () => {
    const sink = new BoundedEvalSink();
    const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    sink.emit({ record: "a", messageUuid: uuid });
    sink.emit({ record: "b" });
    sink.emit({ record: "c", messageUuid: uuid }); // dup
    sink.emit({ record: "d" });

    expect(sink.getRecords()).toEqual(["a", "b", "d"]);
    const stats = sink.getStats();
    expect(stats.dedupEligible).toBe(1);
    expect(stats.duplicateDropCount).toBe(1);
    expect(stats.missingMessageUuid).toBe(2);
  });

  it("empty-string messageUuid is treated as absent", () => {
    const sink = new BoundedEvalSink();
    sink.emit({ record: "x", messageUuid: "" });
    sink.emit({ record: "y", messageUuid: "" });
    expect(sink.getRecords()).toHaveLength(2);
    expect(sink.getStats().missingMessageUuid).toBe(2);
    expect(sink.getStats().duplicateDropCount).toBe(0);
  });
});

describe("BoundedEvalSink — eviction bookkeeping (B5-B6 review R1)", () => {
  it("capacity=1 A→B→A: after A is evicted, re-emitting A is accepted, not dedup-dropped", () => {
    // Regression for the bug GPT flagged in round 2 review:
    // the `seen` set used to grow unbounded — evicted uuids lived
    // forever, so the sink's dedup horizon was lifetime-history
    // instead of bounded-FIFO window. After the fix, eviction prunes
    // `seen`, so re-appearance of an evicted uuid is a fresh record.
    const sink = new BoundedEvalSink({ capacity: 1 });
    const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    expect(sink.emit({ record: "a1", messageUuid: A })).toBe(true);
    expect(sink.emit({ record: "b1", messageUuid: B })).toBe(true);
    // A has now been FIFO-evicted; its uuid must no longer be in `seen`.
    expect(sink.emit({ record: "a2", messageUuid: A })).toBe(true);

    // Final window holds only the newest entry (capacity=1).
    expect(sink.getRecords()).toEqual(["a2"]);

    const stats = sink.getStats();
    // No duplicate drops — all three emits were fresh.
    expect(stats.duplicateDropCount).toBe(0);
    expect(stats.dedupEligible).toBe(3);
    // Two capacity-driven FIFO evictions (a1 → b1 and b1 → a2).
    expect(stats.capacityOverflowCount).toBe(2);
  });

  it("dedup state size never exceeds capacity", () => {
    // Probe via duplicate-drop semantics: after `capacity` distinct
    // uuids plus one more, the first uuid should be accepted again
    // (because it was evicted). If `seen` were unbounded, it would
    // still be considered a duplicate and rejected.
    const capacity = 8;
    const sink = new BoundedEvalSink({ capacity });
    const uuids = Array.from({ length: capacity + 1 }, (_, i) =>
      `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
    );
    for (let i = 0; i < capacity + 1; i++) {
      expect(sink.emit({ record: i, messageUuid: uuids[i] })).toBe(true);
    }
    // uuids[0] has been evicted; re-emitting it should be accepted.
    expect(
      sink.emit({ record: "reappear", messageUuid: uuids[0] }),
    ).toBe(true);
    expect(sink.getStats().duplicateDropCount).toBe(0);
  });

  it("still rejects duplicates that are within the held FIFO window", () => {
    // Complement to the re-appearance test: uuid that is still held
    // must remain a duplicate.
    const sink = new BoundedEvalSink({ capacity: 4 });
    const A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    sink.emit({ record: "a1", messageUuid: A });
    sink.emit({ record: "fill-1" });
    sink.emit({ record: "fill-2" });
    sink.emit({ record: "a-dup", messageUuid: A }); // still in window
    expect(sink.getStats().duplicateDropCount).toBe(1);
    expect(sink.getRecords()).toEqual(["a1", "fill-1", "fill-2"]);
  });
});

describe("BoundedEvalSink — capacity + overflow disclosure", () => {
  it("enforces capacity with FIFO eviction (no silent drop)", () => {
    const disclosures: EvalSinkOverflowDisclosure[] = [];
    const sink = new BoundedEvalSink({
      capacity: 3,
      onOverflow: (d) => disclosures.push(d),
    });

    sink.emit({ record: "a" });
    sink.emit({ record: "b" });
    sink.emit({ record: "c" });
    sink.emit({ record: "d" });
    sink.emit({ record: "e" });

    // FIFO: a and b are evicted; c, d, e remain.
    expect(sink.getRecords()).toEqual(["c", "d", "e"]);

    // Two disclosures — one per capacity eviction past the cap.
    expect(disclosures).toHaveLength(2);
    expect(disclosures.every((d) => d.reason === "capacity-exceeded")).toBe(true);
    expect(disclosures.every((d) => d.droppedCount === 1)).toBe(true);
    expect(disclosures.every((d) => d.capacity === 3)).toBe(true);

    const stats = sink.getStats();
    expect(stats.capacityOverflowCount).toBe(2);
    expect(stats.recordCount).toBe(3);
  });

  it("duplicate-message disclosures include the offending messageUuid", () => {
    const disclosures: EvalSinkOverflowDisclosure[] = [];
    const sink = new BoundedEvalSink({
      onOverflow: (d) => disclosures.push(d),
    });
    const uuid = "99999999-9999-4999-8999-999999999999";

    sink.emit({ record: "a", messageUuid: uuid });
    sink.emit({ record: "b", messageUuid: uuid });

    expect(disclosures).toHaveLength(1);
    expect(disclosures[0]?.reason).toBe("duplicate-message");
    expect(disclosures[0]?.messageUuid).toBe(uuid);
    expect(disclosures[0]?.droppedCount).toBe(1);
  });

  it("disclosure ring buffer caps at `disclosureBufferSize`", () => {
    const sink = new BoundedEvalSink({
      capacity: 1,
      disclosureBufferSize: 3,
    });
    // 5 overflow-drops past cap, but ring holds only the most recent 3.
    for (let i = 0; i < 6; i++) {
      sink.emit({ record: i });
    }
    expect(sink.getDisclosure()).toHaveLength(3);
    expect(sink.getStats().capacityOverflowCount).toBe(5);
  });

  it("onOverflow callback errors are swallowed — observability never crashes emit", () => {
    const sink = new BoundedEvalSink({
      capacity: 1,
      onOverflow: vi.fn(() => {
        throw new Error("observer exploded");
      }),
    });
    // Must not throw.
    expect(() => {
      sink.emit({ record: "a" });
      sink.emit({ record: "b" });
    }).not.toThrow();
  });

  it("disclosure `at` timestamp is set by the injected clock", () => {
    const sink = new BoundedEvalSink({
      capacity: 1,
      now: () => "2026-04-20T00:00:00.000Z",
    });
    sink.emit({ record: "a" });
    sink.emit({ record: "b" });
    expect(sink.getDisclosure()[0]?.at).toBe("2026-04-20T00:00:00.000Z");
  });
});

describe("extractMessageUuid", () => {
  it("returns undefined for non-objects", () => {
    expect(extractMessageUuid(null)).toBeUndefined();
    expect(extractMessageUuid(42)).toBeUndefined();
    expect(extractMessageUuid("x")).toBeUndefined();
    expect(extractMessageUuid(undefined)).toBeUndefined();
  });

  it("extracts direct { messageUuid } field", () => {
    expect(extractMessageUuid({ messageUuid: "abc" })).toBe("abc");
  });

  it("extracts snake_case { message_uuid } field", () => {
    expect(extractMessageUuid({ message_uuid: "abc" })).toBe("abc");
  });

  it("extracts from full NACP envelope shape { envelope: { header: { message_uuid } } }", () => {
    expect(
      extractMessageUuid({
        envelope: { header: { message_uuid: "frame-uuid" } },
      }),
    ).toBe("frame-uuid");
  });

  it("extracts from loose frame shape { header: { message_uuid } }", () => {
    expect(
      extractMessageUuid({
        header: { message_uuid: "hdr-uuid" },
        body: { kind: "turn.begin" },
      }),
    ).toBe("hdr-uuid");
  });

  it("returns undefined on empty-string values", () => {
    expect(extractMessageUuid({ messageUuid: "" })).toBeUndefined();
    expect(extractMessageUuid({ header: { message_uuid: "" } })).toBeUndefined();
  });
});
