/**
 * Context-Management — inspector-facade types.
 *
 * Schema mirrors `P3-context-management-inspector.md §5` — the
 * Claude-Code-style `get_context_usage` shape plus nano-agent
 * multi-worker fields (`pendingCompactJobs`, `bufferPolicy`,
 * `versionedSnapshots`, `tierRouterMetrics`). The facade does not
 * invent its own ergonomics — it presents the same vocabulary B4
 * already speaks elsewhere.
 */

import type {
  BufferPolicy,
  CompactPolicy,
  CategoryUsage,
} from "../budget/index.js";
import type { CompactStateKind, SnapshotMetadata } from "../async-compact/index.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Header constants (lowercase per binding-F02)
// ═══════════════════════════════════════════════════════════════════

export const INSPECTOR_HEADER_BEARER = "x-inspector-bearer";
export const INSPECTOR_HEADER_IP_BYPASS = "x-inspector-ip-allowlist-bypass";
export const INSPECTOR_HEADER_TRACE_UUID = "x-nacp-trace-uuid";

// ═══════════════════════════════════════════════════════════════════
// §2 — Caveat constants
// ═══════════════════════════════════════════════════════════════════

/**
 * Inspector facade ships BEFORE B6 lands `SessionInspector` dedup;
 * duplicate events may appear in the live stream. This caveat is
 * surfaced in `UsageReport.diagnostics` until the dedup writeback
 * (B6-writeback-eval-sink-dedup) closes.
 */
export const INSPECTOR_DEDUP_CAVEAT =
  "duplicate-events-possible-until-b6-dedup";

// ═══════════════════════════════════════════════════════════════════
// §3 — UsageReport
// ═══════════════════════════════════════════════════════════════════

export interface UsageReport {
  // Claude-Code shape
  readonly totalTokens: number;
  readonly maxTokens: number;
  readonly rawMaxTokens: number;
  readonly percentage: number;
  readonly categories: ReadonlyArray<CategoryUsage>;
  readonly memoryFiles?: ReadonlyArray<string>;
  readonly mcpTools?: ReadonlyArray<string>;
  readonly systemTools?: ReadonlyArray<string>;
  readonly systemPromptSections?: ReadonlyArray<string>;

  // nano-agent multi-worker extension
  readonly perWorkerBreakdown?: ReadonlyArray<{
    readonly workerId: string;
    readonly tokens: number;
  }>;
  readonly pendingCompactJobs: ReadonlyArray<{
    readonly stateId: string;
    readonly state: CompactStateKind;
    readonly startedAt: string;
    readonly summarySoFarBytes?: number;
  }>;
  readonly bufferPolicy: {
    readonly hardLimitTokens: number;
    readonly responseReserveTokens: number;
    readonly softCompactTriggerPct: number;
    readonly hardCompactFallbackPct: number;
  };
  readonly versionedSnapshots: ReadonlyArray<SnapshotMetadata>;
  readonly tierRouterMetrics: {
    readonly promotionsThisSession: number;
    readonly r2RefDereferences: number;
    readonly kvStaleReadAttempts: number;
  };
  readonly diagnostics: ReadonlyArray<string>;
}

// ═══════════════════════════════════════════════════════════════════
// §4 — Layer / Policy / Snapshot views
// ═══════════════════════════════════════════════════════════════════

export interface LayerView {
  readonly kind: string;
  readonly tokenEstimate: number;
  readonly required: boolean;
  /** Possibly-redacted preview (max 256 chars). */
  readonly preview: string;
}

export interface PolicyView {
  readonly buffer: BufferPolicy;
  readonly compact: CompactPolicy;
}

export interface CompactStateInspectorView {
  readonly state: CompactStateKind;
  readonly stateId: string;
  readonly enteredAt: string;
  readonly preparedSummaryBytes?: number;
  readonly preparedSnapshotVersion?: number;
}

// ═══════════════════════════════════════════════════════════════════
// §5 — WS subscribe types
// ═══════════════════════════════════════════════════════════════════

export interface SubscribeFilter {
  /** Comma-separated tag list, e.g. `["system","memory"]`. */
  readonly tags?: ReadonlyArray<string>;
  /** Event-name include pattern; supports `ContextCompact*` wildcard. */
  readonly events?: ReadonlyArray<string>;
}

/**
 * A subscription handle returned by `InspectorFacade.subscribeStream`.
 * The worker entry adapts this to the actual WebSocket transport;
 * keeping it transport-agnostic lets us unit-test without spinning up
 * a Hibernation API / ws server.
 */
export interface StreamSubscription {
  /** Cancel the subscription; idempotent. */
  cancel(): void;
  /**
   * Push a candidate event into the subscription. Returns `true` if
   * the event matched the filter and was delivered.
   */
  push(event: { kind: string; tag?: string; body: unknown }): boolean;
}

// ═══════════════════════════════════════════════════════════════════
// §6 — Auth config
// ═══════════════════════════════════════════════════════════════════

export interface InspectorAuthConfig {
  /** Required bearer token (when set). */
  readonly bearerToken?: string;
  /**
   * IP allow-list. CIDR strings (e.g. `10.0.0.0/8`) or exact IPs.
   * Empty / undefined → no IP restriction.
   */
  readonly ipAllowlist?: ReadonlyArray<string>;
  /** Allow `x-inspector-ip-allowlist-bypass` header (dev only). */
  readonly allowDevBypassHeader?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// §7 — Facade config
// ═══════════════════════════════════════════════════════════════════

export interface InspectorFacadeConfig {
  /**
   * Identity of the session this facade serves. Multi-tenant
   * deployments instantiate one facade per session DO.
   */
  readonly sessionUuid: string;

  /**
   * Auth config. Default = no auth (dev). Production deployments MUST
   * set both bearer and IP allowlist.
   */
  readonly auth?: InspectorAuthConfig;

  /**
   * Provider hooks the worker entry wires to actual data sources.
   * Keeps the facade transport- and storage-agnostic.
   */
  readonly providers: InspectorDataProviders;

  /** Override clock for deterministic tests. */
  readonly nowIso?: () => string;

  /**
   * When `true`, the facade attaches `INSPECTOR_DEDUP_CAVEAT` to every
   * `UsageReport.diagnostics`. Default `true` until B6 ships dedup;
   * worker entry can flip to `false` after the writeback closes.
   */
  readonly preB6Dedup?: boolean;
}

/**
 * The worker entry implements these so the facade reads from real
 * data sources in production and from fakes in tests.
 */
export interface InspectorDataProviders {
  readonly getUsageSnapshot: () => Promise<{
    totalTokens: number;
    maxTokens: number;
    responseReserveTokens: number;
    categories: ReadonlyArray<CategoryUsage>;
    rawMaxTokens?: number;
  }>;

  readonly getCompactStateSnapshot: () => Promise<CompactStateInspectorView>;

  readonly getBufferPolicy: () => Promise<{
    hardLimitTokens: number;
    responseReserveTokens: number;
  }>;

  readonly getCompactPolicy: () => Promise<CompactPolicy>;

  readonly getSnapshots: () => Promise<ReadonlyArray<SnapshotMetadata>>;

  readonly getLayers: (
    tag?: string,
  ) => Promise<ReadonlyArray<LayerView>>;

  /**
   * Optional metrics — facade defaults to zero counters when omitted.
   * B7 round-2 cross-colo work will attach the real KV-stale counters.
   */
  readonly getTierRouterMetrics?: () => Promise<{
    promotionsThisSession: number;
    r2RefDereferences: number;
    kvStaleReadAttempts: number;
  }>;

  /**
   * Control endpoints. Each returns the result the facade serialises
   * back to the caller. Throwing is fine; the facade maps errors to
   * 5xx with redacted detail.
   */
  readonly triggerSnapshot?: () => Promise<{ snapshotId: string }>;
  readonly triggerCompact?: (mode: "async" | "sync") => Promise<{ outcome: string }>;
  readonly restoreSnapshot?: (snapshotId: string) => Promise<void>;
}
