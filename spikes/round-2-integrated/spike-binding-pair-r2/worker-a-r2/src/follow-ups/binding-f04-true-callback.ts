/**
 * Follow-up binding-F04 — TRUE callback push path.
 *
 * This is the B7 priority follow-up (§6.2 #5): verify that B6's
 * `BoundedEvalSink` dedup + overflow disclosure contract holds when
 * the sink physically lives in worker-b and worker-a pushes records
 * across a service binding — not when both sides live in the same
 * isolate.
 *
 * Scenario:
 *
 *   1. Reset worker-b's sink with capacity=8.
 *   2. Push 3 records with NEW messageUuids → expect 3 accepted.
 *   3. Push the same 3 messageUuids again → expect 3 rejected (dedup).
 *   4. Push 10 more records with new messageUuids → expect at least
 *      (10 - (capacity-heldCount)) capacity overflow disclosures.
 *   5. Pull `/sink/stats` and `/sink/disclosure` from worker-b; verify
 *      counters reflect what we pushed, not a simulated batch.
 *
 * Pass criteria (writeback-shipped):
 *   - observed `duplicateDropCount` equals 3
 *   - observed `capacityOverflowCount` > 0
 *   - worker-b `getRecords()` snapshot length equals `capacity` (8)
 *
 * Fail → still-open with the mismatch captured as evidence.
 */

import {
  makeBindingResult,
  type BindingProbeResult,
} from "../result-shape.js";

const CAPACITY = 8;

function mkUuid(seed: string): string {
  // A deterministic-ish v4-shaped uuid for deterministic tests.
  const hex = "0000000000000000000000000000000000000000";
  const base = (seed + hex).slice(0, 32);
  return (
    base.slice(0, 8) +
    "-" +
    base.slice(8, 12) +
    "-4" +
    base.slice(13, 16) +
    "-8" +
    base.slice(17, 20) +
    "-" +
    base.slice(20, 32)
  );
}

export async function probeBindingF04TrueCallback(
  workerB: Fetcher,
): Promise<BindingProbeResult> {
  const start = Date.now();

  // 1. Reset sink to capacity=8.
  await workerB.fetch(
    new Request(`https://worker-b/sink/reset?capacity=${CAPACITY}`, {
      method: "POST",
    }),
  );

  async function push(
    records: Array<{ record: unknown; messageUuid?: string }>,
  ): Promise<{ accepted: number; dropped: number }> {
    const resp = await workerB.fetch(
      new Request("https://worker-b/sink/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ records }),
      }),
    );
    const body = (await resp.json()) as { accepted: number; dropped: number };
    return body;
  }

  // 2. Push 3 distinct messages.
  const firstBatch = [0, 1, 2].map((i) => ({
    record: { idx: i, from: "batch-1" },
    messageUuid: mkUuid(`f04-a-${i}`),
  }));
  const first = await push(firstBatch);

  // 3. Replay first batch (dedup).
  const dup = await push(firstBatch);

  // 4. Push 10 new messages — should overflow the cap.
  const secondBatch = Array.from({ length: 10 }, (_, i) => ({
    record: { idx: i, from: "batch-2" },
    messageUuid: mkUuid(`f04-b-${i}`),
  }));
  const second = await push(secondBatch);

  // 5. Collect stats + disclosure.
  const statsResp = await workerB.fetch(
    new Request("https://worker-b/sink/stats", { method: "GET" }),
  );
  const stats = (await statsResp.json()) as {
    stats: {
      duplicateDropCount: number;
      capacityOverflowCount: number;
      totalOverflowCount: number;
      recordCount: number;
      dedupEligible: number;
    };
    recordCount: number;
  };

  const disclosureResp = await workerB.fetch(
    new Request("https://worker-b/sink/disclosure", { method: "GET" }),
  );
  const disclosure = (await disclosureResp.json()) as {
    count: number;
    items: Array<{
      reason: "capacity-exceeded" | "duplicate-message";
      droppedCount: number;
    }>;
  };

  const dedupOk = stats.stats.duplicateDropCount === 3;
  const overflowOk = stats.stats.capacityOverflowCount > 0;
  const windowOk = stats.stats.recordCount === CAPACITY;
  const disclosureOk = disclosure.count >= 2; // at least 1 dup + 1 capacity

  const success = dedupOk && overflowOk && windowOk && disclosureOk;

  return makeBindingResult("V3-binding-f04-true-callback", start, {
    findingId: "spike-binding-pair-binding-F04",
    verdict: success ? "writeback-shipped" : "still-open",
    success,
    mode: "live",
    usedPackages: [
      "@nano-agent/session-do-runtime" /* BoundedEvalSink on worker-b */,
    ],
    caveats: [
      `sink capacity pinned at ${CAPACITY} for this probe; default production capacity is 1024`,
      "push path is cross-Worker via service binding — NOT same-isolate batch (binding-F04 round-1 limitation)",
    ],
    observations: [
      { label: "batch1.accepted", value: first.accepted },
      { label: "batch1.dropped", value: first.dropped },
      { label: "duplicate.accepted", value: dup.accepted },
      { label: "duplicate.dropped", value: dup.dropped },
      { label: "batch2.accepted", value: second.accepted },
      { label: "batch2.dropped", value: second.dropped },
      { label: "stats.duplicateDropCount", value: stats.stats.duplicateDropCount },
      { label: "stats.capacityOverflowCount", value: stats.stats.capacityOverflowCount },
      { label: "stats.recordCount", value: stats.stats.recordCount },
      { label: "disclosure.count", value: disclosure.count },
      { label: "disclosure.reasons", value: disclosure.items.map((d) => d.reason) },
    ],
    errors: success
      ? []
      : [
          {
            code: "binding-f04-mismatch",
            message: `dedupOk=${dedupOk} overflowOk=${overflowOk} windowOk=${windowOk} disclosureOk=${disclosureOk}`,
            count: 1,
          },
        ],
    evidenceRefs: [
      {
        kind: "source",
        locator: "spikes/round-2-integrated/spike-binding-pair-r2/worker-b-r2/src/handlers/eval-sink-ingest.ts",
      },
      {
        kind: "source",
        locator: "packages/session-do-runtime/src/eval-sink.ts",
      },
      {
        kind: "finding-doc",
        locator: "docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md",
      },
    ],
    timings: { samplesN: firstBatch.length + firstBatch.length + secondBatch.length },
  });
}
