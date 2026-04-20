import test from "node:test";
import assert from "node:assert/strict";

/**
 * B7 round-2 integrated contract — local simulation of the probes
 * that would live in `spikes/round-2-integrated/`.
 *
 * Live deployment of the round-2 workers requires Cloudflare account
 * credentials and owner/platform gates (F09_OWNER_URL, F03 cross-colo).
 * This root test runs the probe logic's in-process equivalents so the
 * contract assertions themselves are locked in CI regardless of deploy
 * status. `binding-F04` true-push-path is the key assertion because
 * B7 §6.2 #5 gates the whole phase on that contract actually holding.
 */

import {
  BoundedEvalSink,
  extractMessageUuid,
} from "../packages/session-do-runtime/dist/index.js";
import {
  SessionInspector,
} from "../packages/eval-observability/dist/index.js";
import {
  COMPACT_LIFECYCLE_EVENT_NAMES,
  DEFAULT_COMPACT_POLICY,
  noopLifecycleEmitter,
  shouldArm,
  shouldHardFallback,
} from "../packages/context-management/dist/index.js";

// ─────────────────────────────────────────────────────────────────────
// binding-F04 local simulation — worker-a pushes to worker-b's
// BoundedEvalSink, then queries stats + disclosure. Mirrors the
// probe in `spikes/round-2-integrated/spike-binding-pair-r2/worker-a-r2
// /src/follow-ups/binding-f04-true-callback.ts`.
// ─────────────────────────────────────────────────────────────────────

test("B7 binding-F04 (local-sim) — cap=8; push 3 + 3 dup + 10 overflow", () => {
  const sink = new BoundedEvalSink({ capacity: 8 });

  const batch1 = [0, 1, 2].map((i) => ({
    record: { idx: i },
    messageUuid: `00000000-0000-4000-8000-batch1-${i}`.slice(0, 36),
  }));
  for (const r of batch1) sink.emit(r);

  // Duplicate push — must be fully dedup'd.
  for (const r of batch1) sink.emit(r);

  const batch2 = Array.from({ length: 10 }, (_, i) => ({
    record: { idx: i },
    messageUuid: `00000000-0000-4000-8000-batch2-${i}`.slice(0, 36),
  }));
  for (const r of batch2) sink.emit(r);

  const stats = sink.getStats();
  assert.equal(stats.duplicateDropCount, 3, "3 duplicate pushes must drop");
  assert.ok(stats.capacityOverflowCount > 0, "capacity overflow must disclose");
  assert.equal(stats.recordCount, 8, "sink window holds exactly `capacity`");

  const disclosure = sink.getDisclosure();
  const reasons = new Set(disclosure.map((d) => d.reason));
  assert.ok(reasons.has("duplicate-message"));
  assert.ok(reasons.has("capacity-exceeded"));
});

test("B7 binding-F04 (local-sim) — capacity=1 re-admission guarantees bounded seen-set", () => {
  // Direct regression test for the B5-B6 review R1 eviction fix; if the
  // round-2 integrated spike hits this case it MUST NOT silently drop
  // an evicted-and-returned uuid.
  const sink = new BoundedEvalSink({ capacity: 1 });
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  assert.equal(sink.emit({ record: "a1", messageUuid: A }), true);
  assert.equal(sink.emit({ record: "b1", messageUuid: B }), true);
  assert.equal(sink.emit({ record: "a2", messageUuid: A }), true, "evicted uuid must re-admit");
  assert.equal(sink.getStats().duplicateDropCount, 0);
});

test("B7 binding-F04 (local-sim) — extractMessageUuid pulls from envelope-shaped record", () => {
  const frame = {
    envelope: { header: { message_uuid: "frame-uuid" } },
    body: { kind: "turn.begin" },
  };
  assert.equal(extractMessageUuid(frame), "frame-uuid");
  const sink = new BoundedEvalSink({ capacity: 4 });
  sink.emit({ record: frame, messageUuid: extractMessageUuid(frame) });
  sink.emit({ record: frame, messageUuid: extractMessageUuid(frame) });
  assert.equal(sink.getStats().duplicateDropCount, 1);
});

// ─────────────────────────────────────────────────────────────────────
// SessionInspector — the observer half of binding-F04. Confirms that
// when a frame is handed over, dedup stats are observable.
// ─────────────────────────────────────────────────────────────────────

test("B7 binding-F04 (local-sim) — SessionInspector dedupes on envelope uuid", () => {
  const inspector = new SessionInspector();
  const u = "99999999-9999-4999-8999-999999999999";
  inspector.onSessionFrame({
    header: { message_uuid: u },
    body: { kind: "turn.begin", turn_uuid: "t-1" },
    session_frame: { stream_uuid: "main", stream_seq: 1 },
  });
  inspector.onSessionFrame({
    header: { message_uuid: u },
    body: { kind: "turn.begin", turn_uuid: "t-1-dup" },
    session_frame: { stream_uuid: "main", stream_seq: 2 },
  });
  const stats = inspector.getDedupStats();
  assert.equal(stats.duplicatesDropped, 1);
  assert.equal(inspector.getEvents().length, 1);
});

// ─────────────────────────────────────────────────────────────────────
// B4 seam presence (context.ts re-validation probe local mirror).
// ─────────────────────────────────────────────────────────────────────

test("B7 context re-validation (local-sim) — shipped seams resolve and behave", async () => {
  // Canonical B4 catalog is 5 names (ContextPressure / ContextCompactArmed /
  // ContextCompactPrepareStarted / ContextCompactCommitted / ContextCompactFailed).
  // B5 `ASYNC_COMPACT_HOOK_EVENTS` mirrors these on the hooks side.
  assert.equal(COMPACT_LIFECYCLE_EVENT_NAMES.length, 5, "5 canonical lifecycle names");
  assert.ok(COMPACT_LIFECYCLE_EVENT_NAMES.includes("ContextPressure"));
  assert.ok(COMPACT_LIFECYCLE_EVENT_NAMES.includes("ContextCompactCommitted"));
  const MAX_TOKENS = 200_000;
  const RESERVE = 8_000;
  const low = {
    totalTokens: 1_000,
    maxTokens: MAX_TOKENS,
    responseReserveTokens: RESERVE,
    categories: [],
  };
  // Push above hardFallbackPct (0.95) of the effective prompt budget.
  const effective = MAX_TOKENS - RESERVE;
  const high = {
    totalTokens: Math.ceil(effective * 0.99),
    maxTokens: MAX_TOKENS,
    responseReserveTokens: RESERVE,
    categories: [],
  };
  assert.equal(shouldArm(low, DEFAULT_COMPACT_POLICY), false, "low usage must not arm");
  assert.equal(
    shouldHardFallback(high, DEFAULT_COMPACT_POLICY),
    true,
    "usage above hardFallbackPct must hard-fallback",
  );
  noopLifecycleEmitter.emit({
    name: "ContextPressure",
    sessionUuid: "00000000-0000-4000-8000-000000000000",
    stateId: "round-2-state",
    emittedAt: new Date().toISOString(),
    payload: { source: "B7-local-sim" },
  });
});
