/**
 * Context-Management — UsageReport builder.
 *
 * Pure function — given the data providers' raw outputs, returns a
 * Claude-Code-compatible `UsageReport`. Keeping the calculation pure
 * lets us unit-test the schema without a fake server.
 */

import type { CategoryUsage, CompactPolicy } from "../budget/index.js";
import type { SnapshotMetadata } from "../async-compact/index.js";
import { INSPECTOR_DEDUP_CAVEAT } from "./types.js";
import type { CompactStateInspectorView, UsageReport } from "./types.js";

export interface BuildUsageReportInput {
  readonly usage: {
    readonly totalTokens: number;
    readonly maxTokens: number;
    readonly responseReserveTokens: number;
    readonly categories: ReadonlyArray<CategoryUsage>;
    readonly rawMaxTokens?: number;
  };
  readonly bufferPolicy: {
    readonly hardLimitTokens: number;
    readonly responseReserveTokens: number;
  };
  readonly compactPolicy: CompactPolicy;
  readonly snapshots: ReadonlyArray<SnapshotMetadata>;
  readonly compactState: CompactStateInspectorView;
  readonly tierRouterMetrics?: {
    readonly promotionsThisSession: number;
    readonly r2RefDereferences: number;
    readonly kvStaleReadAttempts: number;
  };
  readonly preB6Dedup?: boolean;
  /** Extra diagnostics to append (e.g. cross-colo freshness caveat). */
  readonly extraDiagnostics?: ReadonlyArray<string>;
}

export function buildUsageReport(input: BuildUsageReportInput): UsageReport {
  const effectiveBudget = Math.max(
    1,
    input.usage.maxTokens - input.usage.responseReserveTokens,
  );
  const percentage = Math.round(
    (input.usage.totalTokens / effectiveBudget) * 1000,
  ) / 10;

  const diagnostics: string[] = [];
  if (input.preB6Dedup !== false) {
    diagnostics.push(INSPECTOR_DEDUP_CAVEAT);
  }
  if (input.extraDiagnostics) {
    diagnostics.push(...input.extraDiagnostics);
  }

  return {
    totalTokens: input.usage.totalTokens,
    maxTokens: input.usage.maxTokens,
    rawMaxTokens: input.usage.rawMaxTokens ?? input.usage.maxTokens,
    percentage,
    categories: input.usage.categories,
    pendingCompactJobs:
      input.compactState.state === "idle"
        ? []
        : [
            {
              stateId: input.compactState.stateId,
              state: input.compactState.state,
              startedAt: input.compactState.enteredAt,
              summarySoFarBytes: input.compactState.preparedSummaryBytes,
            },
          ],
    bufferPolicy: {
      hardLimitTokens: input.bufferPolicy.hardLimitTokens,
      responseReserveTokens: input.bufferPolicy.responseReserveTokens,
      softCompactTriggerPct: input.compactPolicy.softTriggerPct,
      hardCompactFallbackPct: input.compactPolicy.hardFallbackPct,
    },
    versionedSnapshots: input.snapshots,
    tierRouterMetrics: input.tierRouterMetrics ?? {
      promotionsThisSession: 0,
      r2RefDereferences: 0,
      kvStaleReadAttempts: 0,
    },
    diagnostics,
  };
}
