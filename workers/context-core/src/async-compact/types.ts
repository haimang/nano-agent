/**
 * Context-Management — async-compact submodule types.
 *
 * Mirrors the state machine in `PX-async-compact-lifecycle-spec.md §2`:
 *
 *   idle → armed → preparing → committing → committed → idle
 *                                  └→ failed → idle
 *
 * Singleton invariant: a session has at most ONE active compact at any
 * time (state ≠ idle). The orchestrator enforces this in-process; the
 * persistence layer enforces it across worker evictions via
 * `state.storage.transaction()` (per F04 evidence).
 */

import type { ContextLayer } from "../context-layers.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — State machine
// ═══════════════════════════════════════════════════════════════════

export type CompactStateKind =
  | "idle"
  | "armed"
  | "preparing"
  | "committing"
  | "committed"
  | "failed";

/**
 * In-memory + persisted compact state.
 *
 * Persistence (per PX spec §2.3): `armed` / `preparing` / `failed` are
 * persisted under `compact-state:{sessionUuid}` in DO storage so a
 * cold restart can recover. `idle` is the absence of a record.
 */
export interface CompactState {
  readonly kind: CompactStateKind;
  /** Monotonic session-scoped id; helps inspector dedup transitions. */
  readonly stateId: string;
  /** ISO timestamp of the last transition. */
  readonly enteredAt: string;
  /** PrepareJob id when `kind === "preparing"`. */
  readonly prepareJobId?: string;
  /** Last-seen `version` of the committed context (used by diff-aware merge). */
  readonly observedContextVersion?: number;
  /** Failure reason when `kind === "failed"`. */
  readonly failureReason?: string;
  /** Retry counter — capped by `CompactPolicy.maxRetriesAfterFailure`. */
  readonly retriesUsed: number;
}

/** Read-only snapshot exposed to the inspector facade. */
export interface CompactStateSnapshot {
  readonly state: CompactState;
  readonly currentContextVersion: number;
  readonly preparedSummary?: {
    readonly bytes: number;
    readonly snapshotVersion: number;
  };
}

// ═══════════════════════════════════════════════════════════════════
// §2 — CoW context fork (per PX spec §4)
// ═══════════════════════════════════════════════════════════════════

/**
 * The output of `CompactionPlanner.fork(currentContext)`. Layers are
 * shared structurally — mutable kinds (interaction / tool_result) get
 * a new array wrapper but element references are preserved until the
 * candidate is mutated.
 */
export interface ContextCandidate {
  readonly snapshotVersion: number;
  readonly takenAt: string;
  readonly layers: readonly ContextLayer[];
  /** Sum of `tokenEstimate` across layers — fast read for prepare prompt. */
  readonly tokenEstimate: number;
}

// ═══════════════════════════════════════════════════════════════════
// §3 — Background prepare job
// ═══════════════════════════════════════════════════════════════════

/**
 * The summarization output produced by the background LLM call.
 * `sizeBytes` is the post-encode UTF-8 byte length used by the
 * committer to decide between inline (DO) and promoted (R2) storage.
 */
export interface PreparedSummary {
  readonly prepareJobId: string;
  readonly snapshotVersion: number;
  readonly text: string;
  readonly sizeBytes: number;
  readonly producedAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// §4 — Commit outcome
// ═══════════════════════════════════════════════════════════════════

/**
 * Versioned snapshot persistent in DO storage / promoted to R2.
 * Surfaced to the inspector facade so users can see available rollback
 * targets.
 */
export interface SnapshotMetadata {
  readonly snapshotId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly reason: "pre-compact" | "user-explicit" | "scheduled";
  readonly sizeBytes: number;
  readonly storage: "do" | "r2";
  readonly storageKey: string;
}

/**
 * Result of a commit attempt. `committed` is the happy path;
 * `no-compact-pending` means there was nothing to commit;
 * `fallback-sync` means the orchestrator escalated to the sync path;
 * `failed` carries the underlying error context.
 */
export type CommitOutcome =
  | {
      kind: "committed";
      oldVersion: number;
      newVersion: number;
      summary: { storage: "do" | "r2"; storageKey: string; sizeBytes: number };
    }
  | { kind: "no-compact-pending" }
  | { kind: "fallback-sync"; reason: string }
  | { kind: "failed"; error: string };

// ═══════════════════════════════════════════════════════════════════
// §5 — LLM provider seam
// ═══════════════════════════════════════════════════════════════════

/**
 * The minimum LLM provider contract `prepare-job` consumes. Mirrors
 * the `llm-wrapper` adapter shape but kept narrow so tests can pass
 * fake implementations without dragging in provider-specific types.
 *
 * The `signal` MUST cause the underlying call to be cancelled — the
 * scheduler relies on this to enforce `BACKGROUND_TIMEOUT_MS`.
 */
export interface LlmSummarizeRequest {
  readonly candidate: ContextCandidate;
  readonly sessionUuid: string;
  readonly signal: AbortSignal;
}

export interface LlmSummarizeProvider {
  summarize(request: LlmSummarizeRequest): Promise<{ text: string }>;
}

// ═══════════════════════════════════════════════════════════════════
// §6 — Lifecycle event seam (B4↔B5 gate)
// ═══════════════════════════════════════════════════════════════════

/**
 * 5 lifecycle event names per `PX-async-compact-lifecycle-spec.md §7`.
 * **Stringly typed** intentionally — current `@nano-agent/hooks`
 * `HookEventName` is a strict union that does NOT include these yet
 * (B5 will register them in the catalog). The B4 emitter therefore
 * uses a parallel string channel + a B5-supplied bridge adapter.
 */
export const COMPACT_LIFECYCLE_EVENT_NAMES = [
  "ContextPressure",
  "ContextCompactArmed",
  "ContextCompactPrepareStarted",
  "ContextCompactCommitted",
  "ContextCompactFailed",
] as const;

export type CompactLifecycleEventName =
  (typeof COMPACT_LIFECYCLE_EVENT_NAMES)[number];

/** A lifecycle event emitted by the orchestrator. */
export interface LifecycleEvent {
  readonly name: CompactLifecycleEventName;
  readonly sessionUuid: string;
  readonly stateId: string;
  readonly emittedAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Channel the orchestrator uses to surface lifecycle events. B4 ships
 * a noop default + a bridge factory so B5 can attach a real
 * `HookDispatcher` once the catalog has the new event names.
 */
export interface LifecycleEventEmitter {
  emit(event: LifecycleEvent): void;
}
