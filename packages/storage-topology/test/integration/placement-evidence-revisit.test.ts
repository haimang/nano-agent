/**
 * Integration — revisit a provisional placement using real runtime
 * evidence produced by `@nano-agent/eval-observability`'s
 * `StoragePlacementLog`.
 *
 * Flow:
 *   1. A `StoragePlacementLog` records several placement evidence
 *      entries for `session-messages` on `do-storage` (with bytes).
 *   2. `placementLogToEvidence()` converts those entries into
 *      `EvidenceSignal[]`.
 *   3. `evaluateEvidence()` inspects them against the current
 *      provisional placement and suggests a different backend when
 *      warranted.
 */

import { describe, it, expect } from "vitest";
import { StoragePlacementLog } from "../../../eval-observability/src/placement-log.js";
import {
  DEFAULT_DO_SIZE_THRESHOLD_BYTES,
  evaluateEvidence,
  placementLogToEvidence,
} from "../../src/calibration.js";
import { getPlacement } from "../../src/placement.js";

describe("integration: StoragePlacementLog → calibrator", () => {
  it("feeds real eval-observability placement entries into the calibrator and flips a demotion", () => {
    const log = new StoragePlacementLog();

    // 3 real placement entries — all oversized DO-storage writes.
    log.record({
      dataItem: "session-messages",
      storageLayer: "do-storage",
      key: "tenants/team-1/sessions/s1/messages",
      op: "write",
      sizeBytes: 2_000_000,
      timestamp: "2026-04-17T00:00:00.000Z",
    });
    log.record({
      dataItem: "session-messages",
      storageLayer: "do-storage",
      key: "tenants/team-1/sessions/s1/messages",
      op: "write",
      sizeBytes: 1_500_000,
      timestamp: "2026-04-17T00:00:01.000Z",
    });
    log.record({
      dataItem: "session-messages",
      storageLayer: "do-storage",
      key: "tenants/team-1/sessions/s1/messages",
      op: "read",
      timestamp: "2026-04-17T00:00:02.000Z",
    });

    const entries = log.getEntries();
    const signals = placementLogToEvidence(entries);
    expect(signals.length).toBeGreaterThan(0);

    const hypothesis = getPlacement("session-messages");
    expect(hypothesis).toBeDefined();

    const result = evaluateEvidence(signals, hypothesis!);
    expect(result.action).toBe("change-placement");
    expect(result.suggestedBackend).toBe("r2");
    expect(result.revisitContext.signalCount).toBeGreaterThan(0);
    expect(result.revisitContext.thresholdBytes).toBe(DEFAULT_DO_SIZE_THRESHOLD_BYTES);
  });

  it("does not recommend a change when all observed sizes stay under the provisional threshold", () => {
    const log = new StoragePlacementLog();
    log.record({
      dataItem: "session-messages",
      storageLayer: "do-storage",
      key: "tenants/t/s/m",
      op: "write",
      sizeBytes: 8_192,
      timestamp: "2026-04-17T00:00:00.000Z",
    });

    const hypothesis = getPlacement("session-messages")!;
    const result = evaluateEvidence(placementLogToEvidence(log.getEntries()), hypothesis);
    expect(result.action).toBe("maintain");
  });

  it("honours a caller-supplied threshold override (R5: threshold is tunable)", () => {
    const log = new StoragePlacementLog();
    log.record({
      dataItem: "session-messages",
      storageLayer: "do-storage",
      key: "tenants/t/s/m",
      op: "write",
      sizeBytes: 8_192,
      timestamp: "2026-04-17T00:00:00.000Z",
    });

    const hypothesis = getPlacement("session-messages")!;
    const result = evaluateEvidence(placementLogToEvidence(log.getEntries()), hypothesis, {
      doSizeThresholdBytes: 4_096,
    });
    expect(result.action).toBe("change-placement");
    expect(result.revisitContext.thresholdBytes).toBe(4_096);
  });
});
