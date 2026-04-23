import test from "node:test";
import assert from "node:assert/strict";

import {
  SessionInspector,
} from "../packages/eval-observability/dist/index.js";
import {
  BoundedEvalSink,
  extractMessageUuid,
} from "../packages/session-do-runtime/dist/index.js";

// B6 — `docs/rfc/nacp-core-1-2-0.md` §4.2 dedup contract root test.
// Anchors the producer/consumer contract between the NACP envelope's
// `header.message_uuid` and the two consumer-side dedup seams shipped
// in B6: `SessionInspector` (eval-observability) and `BoundedEvalSink`
// (session-do-runtime).

test("B6 §4.2 — SessionInspector deduplicates on envelope messageUuid, not body fields", () => {
  const inspector = new SessionInspector();
  const uuid = "77777777-7777-4777-8777-777777777777";

  inspector.onStreamEvent(
    "turn.begin",
    1,
    { turn_uuid: "t-1" },
    { messageUuid: uuid },
  );
  inspector.onStreamEvent(
    "turn.begin",
    2,
    { turn_uuid: "t-2" }, // different body
    { messageUuid: uuid }, // same envelope uuid
  );

  const events = inspector.getEvents();
  assert.equal(events.length, 1, "duplicate messageUuid must be dropped");
  assert.equal(events[0].seq, 1);
  assert.equal(events[0].messageUuid, uuid);

  const stats = inspector.getDedupStats();
  assert.equal(stats.duplicatesDropped, 1);
  assert.equal(stats.dedupEligible, 1);
});

test("B6 §4.2 — SessionInspector treats missing messageUuid as NOT-dedup (backward compat)", () => {
  const inspector = new SessionInspector();

  inspector.onStreamEvent("turn.begin", 1, { turn_uuid: "t-1" });
  inspector.onStreamEvent("turn.begin", 2, { turn_uuid: "t-1" });

  assert.equal(inspector.getEvents().length, 2);
  assert.equal(inspector.getDedupStats().duplicatesDropped, 0);
});

test("B6 §4.2 — SessionInspector.onSessionFrame extracts header.message_uuid (dedup key source proof)", () => {
  const inspector = new SessionInspector();
  const frame = {
    header: { message_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    body: { kind: "llm.delta", content_type: "text", content: "hi", is_final: false },
    session_frame: { stream_uuid: "main", stream_seq: 3 },
  };
  inspector.onSessionFrame(frame);
  inspector.onSessionFrame(frame);
  inspector.onSessionFrame(frame);

  assert.equal(inspector.getEvents().length, 1);
  assert.equal(inspector.getDedupStats().duplicatesDropped, 2);
});

test("B6 §4.2 — BoundedEvalSink overflow is NOT silent (disclosure records appear)", () => {
  const sink = new BoundedEvalSink({ capacity: 2 });
  sink.emit({ record: "a" });
  sink.emit({ record: "b" });
  sink.emit({ record: "c" });
  sink.emit({ record: "d" });

  const disclosure = sink.getDisclosure();
  assert.ok(disclosure.length >= 2, "each overflow must be disclosed");
  assert.ok(
    disclosure.every((d) => d.reason === "capacity-exceeded"),
    "capacity evictions must be tagged reason: capacity-exceeded",
  );

  const stats = sink.getStats();
  assert.equal(stats.capacityOverflowCount, 2);
  assert.equal(stats.recordCount, 2);
});

test("B6 §4.2 — BoundedEvalSink duplicate-drop disclosure carries the offending messageUuid", () => {
  const sink = new BoundedEvalSink();
  const uuid = "99999999-9999-4999-8999-999999999999";
  sink.emit({ record: "a", messageUuid: uuid });
  sink.emit({ record: "b", messageUuid: uuid });

  const disclosure = sink.getDisclosure();
  assert.equal(disclosure.length, 1);
  assert.equal(disclosure[0].reason, "duplicate-message");
  assert.equal(disclosure[0].messageUuid, uuid);
});

test("B6 §4.2 — extractMessageUuid walks envelope shapes used by default sink producers", () => {
  assert.equal(extractMessageUuid({ messageUuid: "a" }), "a");
  assert.equal(extractMessageUuid({ message_uuid: "b" }), "b");
  assert.equal(
    extractMessageUuid({ envelope: { header: { message_uuid: "c" } } }),
    "c",
  );
  assert.equal(
    extractMessageUuid({ header: { message_uuid: "d" } }),
    "d",
  );
  assert.equal(extractMessageUuid({}), undefined);
  assert.equal(extractMessageUuid({ messageUuid: "" }), undefined);
  assert.equal(extractMessageUuid(null), undefined);
});
