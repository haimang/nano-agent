/**
 * @nano-agent/eval-observability — Phase 6 evidence bridge (A7 Phase 2).
 *
 * Two adapters complete the runtime evidence loop without forcing a
 * runtime package to take a dependency on `storage-topology`:
 *
 *   1. `bridgeEvidenceToPlacementLog(recorder, log)` — replay every
 *      `placement` evidence record into a legacy `StoragePlacementLog`
 *      so existing consumers (root e2e-10, integration tests,
 *      `placementLogToEvidence()`) keep working.
 *
 *   2. `placementEvidenceFromRecord(record)` — turn a typed
 *      `PlacementEvidence` into the `PlacementEntry` shape the
 *      placement log expects. Useful when a runtime emitter wants to
 *      both record the typed evidence AND keep the log up to date in a
 *      single call site.
 *
 * The bridge is **the only sanctioned coupling** between the new
 * five-stream evidence vocabulary and the legacy `StoragePlacementLog`
 * — so future cleanup can retire `StoragePlacementLog` by removing this
 * file alone.
 */

import type {
  EvidenceRecord,
  EvidenceRecorder,
  PlacementEvidence,
} from "./evidence-streams.js";
import type { PlacementEntry } from "./placement-log.js";

/** Convert a typed placement-evidence record into a placement-log entry. */
export function placementEvidenceFromRecord(
  evidence: PlacementEvidence,
): PlacementEntry & { sessionUuid?: string } {
  return {
    dataItem: evidence.dataItem,
    storageLayer: evidence.backend,
    key: evidence.key ?? "",
    op:
      evidence.op === "promote"
        ? "write"
        : evidence.op === "demote"
          ? "delete"
          : evidence.op === "list"
            ? "read"
            : evidence.op,
    sizeBytes: evidence.sizeBytes,
    timestamp: evidence.anchor.timestamp,
    // Carry sessionUuid as an extra field — `placementLogToEvidence`
    // already reads it via duck typing.
    sessionUuid: evidence.anchor.sessionUuid,
  };
}

/**
 * Mirror every `placement` record on `recorder` into the supplied
 * `StoragePlacementLog`-shaped target. Returns the number of records
 * forwarded so callers can assert the bridge is working.
 *
 * `target` is duck-typed to keep this module dependency-free; it just
 * needs a `record(entry)` method.
 */
export function bridgeEvidenceToPlacementLog(
  recorder: EvidenceRecorder,
  target: { record(entry: PlacementEntry & { sessionUuid?: string }): void },
): number {
  let count = 0;
  for (const record of recorder.all()) {
    if (record.stream === "placement") {
      target.record(placementEvidenceFromRecord(record));
      count += 1;
    }
  }
  return count;
}

/**
 * One-shot helper for runtime callers that want to record a placement
 * action both into the typed evidence stream and the legacy
 * placement log in a single statement.
 */
export function recordPlacementEvidence(
  evidence: PlacementEvidence,
  recorder: { emit(r: EvidenceRecord): void | Promise<void> },
  log?: { record(entry: PlacementEntry & { sessionUuid?: string }): void },
): void {
  void recorder.emit(evidence);
  if (log) log.record(placementEvidenceFromRecord(evidence));
}
