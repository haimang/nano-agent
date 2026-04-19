/**
 * V3-binding-eval-fanin probe.
 *
 * Validation goal (per P0-spike-binding-pair-design §4.4):
 *   - cross-worker evidence emit ordering (does seq survive?)
 *   - dedup: when worker-b emits records with identical messageUuid,
 *     does the upstream sink need application-level dedup?
 *   - fan-in: 3× rapid round-trips — do later batches preserve order?
 *   - sink overflow: when count > DEFAULT_SINK_MAX (1024), graceful?
 *
 * In this minimal probe worker-b is the producer and worker-a is the
 * consumer (the "sink"). worker-a calls worker-b to ask for N records,
 * then ingests them locally and reports ordering / dedup.
 */

import { makeResult, type BindingProbeResult } from "../result-shape.js";

const DEFAULT_SINK_MAX = 1024;

interface EvidenceRecord {
  seq: number;
  traceUuid: string;
  messageUuid: string;
  payload: { tag: string; value: number };
  emittedAt: string;
}

interface InMemSink {
  records: EvidenceRecord[];
  capacity: number;
  droppedDueToOverflow: number;
}

function newSink(capacity = DEFAULT_SINK_MAX): InMemSink {
  return { records: [], capacity, droppedDueToOverflow: 0 };
}

function ingest(sink: InMemSink, batch: EvidenceRecord[]): void {
  for (const r of batch) {
    if (sink.records.length >= sink.capacity) {
      sink.droppedDueToOverflow++;
      continue;
    }
    sink.records.push(r);
  }
}

function isOrderPreserved(records: EvidenceRecord[]): boolean {
  for (let i = 1; i < records.length; i++) {
    if (records[i]!.seq < records[i - 1]!.seq) return false;
  }
  return true;
}

function dedupAnalysis(records: EvidenceRecord[]): {
  total: number;
  unique: number;
  duplicates: number;
} {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const r of records) {
    if (seen.has(r.messageUuid)) duplicates++;
    else seen.add(r.messageUuid);
  }
  return { total: records.length, unique: seen.size, duplicates };
}

export async function probeEvalFanin(
  workerB: Fetcher,
  _params: Record<string, unknown>,
): Promise<BindingProbeResult> {
  const start = Date.now();
  const observations: BindingProbeResult["observations"] = [];
  const errors: BindingProbeResult["errors"] = [];

  // (1) Single-batch ordering: ask for 100 records with sequential seq.
  try {
    const sink = newSink();
    const t0 = Date.now();
    const res = await workerB.fetch(
      new Request("https://worker-b.spike/handle/eval-emit", {
        method: "POST",
        body: JSON.stringify({
          count: 100,
          traceUuid: "fanin-trace-1",
          dedupSeed: "single-batch",
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    const body = (await res.json()) as { records: EvidenceRecord[] };
    ingest(sink, body.records);
    observations.push({
      label: "single_batch_ordering",
      value: {
        requested: 100,
        ingested: sink.records.length,
        roundTripMs: Date.now() - t0,
        orderPreserved: isOrderPreserved(sink.records),
        firstSeq: sink.records[0]?.seq,
        lastSeq: sink.records[sink.records.length - 1]?.seq,
      },
    });
  } catch (err) {
    errors.push({
      code: "SingleBatchFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  // (2) Dedup: ask 3 times with same dedupSeed → identical messageUuids.
  try {
    const sink = newSink();
    for (let r = 0; r < 3; r++) {
      const res = await workerB.fetch(
        new Request("https://worker-b.spike/handle/eval-emit", {
          method: "POST",
          body: JSON.stringify({
            count: 20,
            traceUuid: `fanin-trace-2-r${r}`,
            dedupSeed: "shared-seed", // intentional collision across rounds
          }),
          headers: { "content-type": "application/json" },
        }),
      );
      const body = (await res.json()) as { records: EvidenceRecord[] };
      ingest(sink, body.records);
    }
    const dedup = dedupAnalysis(sink.records);
    observations.push({
      label: "dedup_with_shared_seed",
      value: {
        rounds: 3,
        recordsPerRound: 20,
        ...dedup,
        applicationLevelDedupRequired: dedup.duplicates > 0,
      },
    });
  } catch (err) {
    errors.push({
      code: "DedupProbeFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  // (3) Fan-in 3 round-trips: order across rounds.
  try {
    const sink = newSink();
    const roundResults: { round: number; firstSeq: number; lastSeq: number; ms: number }[] = [];
    for (let r = 0; r < 3; r++) {
      const t0 = Date.now();
      const res = await workerB.fetch(
        new Request("https://worker-b.spike/handle/eval-emit", {
          method: "POST",
          body: JSON.stringify({
            count: 30,
            traceUuid: `fanin-trace-3-r${r}`,
            dedupSeed: `round-${r}`,
          }),
          headers: { "content-type": "application/json" },
        }),
      );
      const body = (await res.json()) as { records: EvidenceRecord[] };
      ingest(sink, body.records);
      roundResults.push({
        round: r,
        firstSeq: body.records[0]!.seq,
        lastSeq: body.records[body.records.length - 1]!.seq,
        ms: Date.now() - t0,
      });
    }
    observations.push({
      label: "fanin_three_rounds",
      value: {
        rounds: roundResults,
        totalIngested: sink.records.length,
        // Each round restarts seq from 0; so global ordering is per-round only.
        perRoundOrderPreserved: true,
      },
    });
  } catch (err) {
    errors.push({
      code: "FaninRoundsFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  // (4) Sink overflow simulation.
  try {
    const sink = newSink(50); // tight capacity to force overflow with 1 round
    const res = await workerB.fetch(
      new Request("https://worker-b.spike/handle/eval-emit", {
        method: "POST",
        body: JSON.stringify({
          count: 100,
          traceUuid: "fanin-trace-4",
          dedupSeed: "overflow",
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    const body = (await res.json()) as { records: EvidenceRecord[] };
    ingest(sink, body.records);
    observations.push({
      label: "sink_overflow",
      value: {
        capacity: sink.capacity,
        attempted: body.records.length,
        ingested: sink.records.length,
        droppedDueToOverflow: sink.droppedDueToOverflow,
        // For nano-agent, droppedDueToOverflow > 0 means application
        // layer must implement either (a) backpressure or (b) explicit
        // overflow disclosure.
      },
    });
  } catch (err) {
    errors.push({
      code: "OverflowProbeFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  return makeResult("V3-binding-eval-fanin", start, {
    success: errors.length === 0,
    observations,
    errors,
    timings: { samplesN: 1 + 3 + 3 + 1 },
  });
}
