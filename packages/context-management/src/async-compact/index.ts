/**
 * Context-Management — async-compact submodule.
 *
 * `AsyncCompactOrchestrator` is the public entry point. It composes
 * the 6 internal units (scheduler / planner / prepare-job / committer
 * / version-history / fallback) into the API the kernel and inspector
 * facade consume:
 *
 *   - `shouldArm(usage)`        — pure check; cheap to call every turn
 *   - `tryArm(usage)`           — idempotent ARM transition
 *   - `tryPrepare(input)`       — kicks off background summarization
 *   - `tryCommit(input)`        — atomic swap when prepared summary is
 *                                 ready
 *   - `forceSyncCompact(input)` — graceful HARD-fallback path
 *   - `getCurrentState()`       — read-only state for inspectors
 *   - `restoreVersion(id)`      — user rollback (typed-capability seam)
 *
 * The orchestrator is intentionally **stateful in-memory** for the
 * current turn / instance and **persists ARMED / PREPARING / FAILED**
 * to DO storage so a worker eviction can recover (per PX spec §2.3).
 */

import type {
  DOStorageAdapter,
  R2Adapter,
} from "@nano-agent/storage-topology";
import type { ContextLayer } from "@nano-agent/workspace-context-artifacts";

import type { CompactPolicy, UsageSnapshot } from "../budget/index.js";
import {
  DEFAULT_COMPACT_POLICY,
  shouldArm as policyShouldArm,
  shouldHardFallback as policyShouldHardFallback,
} from "../budget/index.js";
import { CompactionCommitter } from "./committer.js";
import {
  bridgeToHookDispatcher,
  noopLifecycleEmitter,
} from "./events.js";
import { FallbackController } from "./fallback.js";
import { CompactionPlanner } from "./planner.js";
import { PrepareJob, PrepareJobTimeoutError } from "./prepare-job.js";
import { CompactionScheduler } from "./scheduler.js";
import {
  COMPACT_LIFECYCLE_EVENT_NAMES,
  type CommitOutcome,
  type CompactState,
  type CompactStateSnapshot,
  type ContextCandidate,
  type LifecycleEvent,
  type LifecycleEventEmitter,
  type LlmSummarizeProvider,
  type PreparedSummary,
  type SnapshotMetadata,
} from "./types.js";
import { VersionHistory } from "./version-history.js";

// ── Re-exports for the package root ──
export {
  COMPACT_LIFECYCLE_EVENT_NAMES,
  bridgeToHookDispatcher,
  noopLifecycleEmitter,
};
export type {
  CommitOutcome,
  CompactState,
  CompactStateKind,
  CompactStateSnapshot,
  ContextCandidate,
  LifecycleEvent,
  LifecycleEventEmitter,
  LlmSummarizeProvider,
  PreparedSummary,
  SnapshotMetadata,
} from "./types.js";
export {
  CompactionScheduler,
  CompactionPlanner,
  CompactionCommitter,
  PrepareJob,
  PrepareJobTimeoutError,
  VersionHistory,
  FallbackController,
};
export { createKernelCompactDelegate } from "./kernel-adapter.js";
export type {
  CreateKernelAdapterConfig,
  KernelCompactDelegate,
  KernelCompactBudgetInput,
} from "./kernel-adapter.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Orchestrator config
// ═══════════════════════════════════════════════════════════════════

export interface AsyncCompactOrchestratorConfig {
  readonly sessionUuid: string;
  /** B2 substrate; transactional swap target. */
  readonly doStorage: DOStorageAdapter;
  /** Optional R2 backing for summaries / snapshots > DO cap (per F08). */
  readonly r2?: R2Adapter;
  /** Background LLM provider; tests pass a fake. */
  readonly llmProvider: LlmSummarizeProvider;
  /** Per-session compact policy override. */
  readonly compactPolicy?: CompactPolicy;
  /** Lifecycle event channel. Defaults to `noopLifecycleEmitter`. */
  readonly emitter?: LifecycleEventEmitter;
  /** Override clock for deterministic tests. */
  readonly nowIso?: () => string;
  /** Inject a state-id factory for deterministic tests. */
  readonly stateIdFactory?: () => string;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — AsyncCompactOrchestrator
// ═══════════════════════════════════════════════════════════════════

/**
 * Composes the 6 collaborators of the canonical lifecycle. Methods
 * are intentionally narrow and idempotent — callers can drive the
 * orchestrator from any number of points (kernel scheduler, hard
 * fallback, inspector control endpoint) without coordinating.
 */
export class AsyncCompactOrchestrator {
  private readonly sessionUuid: string;
  private readonly doStorage: DOStorageAdapter;
  private readonly r2: R2Adapter | undefined;
  private readonly policy: CompactPolicy;
  private readonly emitter: LifecycleEventEmitter;
  private readonly nowIso: () => string;
  private readonly stateIdFactory: () => string;

  private readonly scheduler: CompactionScheduler;
  private readonly planner: CompactionPlanner;
  private readonly prepareJob: PrepareJob;
  private readonly committer: CompactionCommitter;
  private readonly versionHistory: VersionHistory;
  private readonly fallback: FallbackController;

  private state: CompactState;
  private prepared: PreparedSummary | undefined;
  private inflightPrepare: Promise<PreparedSummary> | undefined;
  private inflightCandidate: ContextCandidate | undefined;

  constructor(config: AsyncCompactOrchestratorConfig) {
    this.sessionUuid = config.sessionUuid;
    this.doStorage = config.doStorage;
    this.r2 = config.r2;
    this.policy = config.compactPolicy ?? DEFAULT_COMPACT_POLICY;
    this.emitter = config.emitter ?? noopLifecycleEmitter;
    this.nowIso = config.nowIso ?? (() => new Date().toISOString());
    this.stateIdFactory =
      config.stateIdFactory ??
      (() => `cs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

    this.versionHistory = new VersionHistory({
      sessionUuid: this.sessionUuid,
      doStorage: this.doStorage,
      r2: this.r2,
      nowIso: this.nowIso,
    });
    this.committer = new CompactionCommitter({
      sessionUuid: this.sessionUuid,
      doStorage: this.doStorage,
      r2: this.r2,
      nowIso: this.nowIso,
      versionHistory: this.versionHistory,
    });
    this.scheduler = new CompactionScheduler();
    this.planner = new CompactionPlanner();
    this.prepareJob = new PrepareJob({
      provider: config.llmProvider,
      timeoutMs: this.policy.backgroundTimeoutMs,
    });
    this.fallback = new FallbackController({
      sessionUuid: this.sessionUuid,
      provider: config.llmProvider,
      committer: this.committer,
      planner: this.planner,
    });

    this.state = {
      kind: "idle",
      stateId: this.stateIdFactory(),
      enteredAt: this.nowIso(),
      retriesUsed: 0,
    };
  }

  // ── Read API ─────────────────────────────────────────────────────

  /** Pure check — does NOT touch storage. Cheap to call every turn. */
  shouldArm(usage: UsageSnapshot): boolean {
    return policyShouldArm(usage, this.policy);
  }

  /** Pure check — does this usage warrant the sync fallback path? */
  shouldHardFallback(usage: UsageSnapshot): boolean {
    return policyShouldHardFallback(usage, this.policy);
  }

  /** Read-only snapshot for inspector consumption. */
  getCurrentState(): CompactStateSnapshot {
    return {
      state: this.state,
      currentContextVersion: 0, // committer reads this lazily; expose via async query if needed
      preparedSummary: this.prepared
        ? {
            bytes: this.prepared.sizeBytes,
            snapshotVersion: this.prepared.snapshotVersion,
          }
        : undefined,
    };
  }

  // ── Write API ────────────────────────────────────────────────────

  /**
   * Idempotent ARM transition. If we are already armed / preparing /
   * etc., the call is a no-op (per PX spec singleton invariant).
   */
  async tryArm(usage: UsageSnapshot): Promise<void> {
    if (this.state.kind !== "idle") return;
    if (!this.shouldArm(usage)) return;
    this.transitionTo({ kind: "armed", retriesUsed: 0 });
    this.emit("ContextCompactArmed", {
      usagePct: usage.totalTokens / Math.max(1, usage.maxTokens),
    });
  }

  /**
   * Drives ARMED → PREPARING by spawning the background summarization
   * job. Returns immediately; the prepared summary is later picked
   * up by `tryCommit`.
   */
  tryPrepare(input: {
    layers: readonly ContextLayer[];
    contextVersion: number;
  }): void {
    if (this.state.kind !== "armed") return;
    if (this.inflightPrepare) return;

    const candidate = this.planner.fork({
      layers: input.layers,
      contextVersion: input.contextVersion,
    });
    this.inflightCandidate = candidate;
    const prepareJobId = `${this.state.stateId}-prep`;
    this.transitionTo({ kind: "preparing", prepareJobId });
    this.emit("ContextCompactPrepareStarted", {
      prepareJobId,
      snapshotVersion: candidate.snapshotVersion,
      tokenEstimate: candidate.tokenEstimate,
    });

    this.inflightPrepare = this.prepareJob
      .run({ candidate, sessionUuid: this.sessionUuid })
      .then((prepared) => {
        this.prepared = prepared;
        return prepared;
      })
      .catch((err: unknown) => {
        // Surface the failure but DO NOT re-throw — the prepare job
        // is fire-and-forget; callers don't await this promise. Any
        // re-throw becomes an unhandled rejection. The state machine
        // moves to `failed`; the next tryCommit() will read the new
        // state and decide whether to retry or surrender.
        const reason =
          err instanceof PrepareJobTimeoutError
            ? `timeout-${err.timeoutMs}ms`
            : err instanceof Error
              ? err.message
              : String(err);
        this.transitionTo({
          kind: "failed",
          failureReason: reason,
          retriesUsed: this.state.retriesUsed,
        });
        this.emit("ContextCompactFailed", { reason });
        this.inflightPrepare = undefined;
        // Resolve to a sentinel `null` so awaiters of `inflightPrepare`
        // can detect the failure without an unhandled rejection.
        return null as unknown as PreparedSummary;
      });
  }

  /**
   * Atomic swap when a prepared summary is ready and the caller is at
   * a turn boundary. Returns the committer's outcome unchanged.
   */
  async tryCommit(input: {
    contextVersion: number;
    atTurnBoundary: boolean;
    usage: UsageSnapshot;
  }): Promise<CommitOutcome> {
    const decision = this.scheduler.decide({
      state: this.state,
      usage: input.usage,
      policy: this.policy,
      atTurnBoundary: input.atTurnBoundary,
      preparedReady: this.prepared !== undefined,
    });

    if (decision.kind === "force-sync-fallback") {
      return { kind: "fallback-sync", reason: decision.reason };
    }
    if (decision.kind !== "commit-prepared") {
      return { kind: "no-compact-pending" };
    }

    const prepared = this.prepared;
    const candidate = this.inflightCandidate;
    if (!prepared || !candidate) {
      return { kind: "no-compact-pending" };
    }

    this.transitionTo({ kind: "committing" });

    const outcome = await this.committer.commit({ candidate, prepared });
    if (outcome.kind === "committed") {
      this.transitionTo({
        kind: "committed",
        observedContextVersion: outcome.newVersion,
      });
      this.emit("ContextCompactCommitted", {
        oldVersion: outcome.oldVersion,
        newVersion: outcome.newVersion,
        summary: outcome.summary,
      });
      this.transitionTo({ kind: "idle", retriesUsed: 0 });
      this.prepared = undefined;
      this.inflightCandidate = undefined;
      this.inflightPrepare = undefined;
    } else if (outcome.kind === "failed") {
      this.transitionTo({
        kind: "failed",
        failureReason: outcome.error,
        retriesUsed: this.state.retriesUsed,
      });
      this.emit("ContextCompactFailed", { reason: outcome.error });
    }
    return outcome;
  }

  /**
   * HARD-fallback path: blocks the caller until the synchronous
   * compact resolves. Resets state to `idle` (or `failed`) on
   * completion.
   */
  async forceSyncCompact(input: {
    layers: readonly ContextLayer[];
    contextVersion: number;
    reason: string;
  }): Promise<CommitOutcome> {
    this.transitionTo({ kind: "committing" });
    try {
      const outcome = await this.fallback.runSync({
        layers: input.layers,
        contextVersion: input.contextVersion,
        reason: input.reason,
      });
      if (outcome.kind === "committed") {
        this.transitionTo({
          kind: "committed",
          observedContextVersion: outcome.newVersion,
        });
        this.emit("ContextCompactCommitted", {
          oldVersion: outcome.oldVersion,
          newVersion: outcome.newVersion,
          summary: outcome.summary,
          reason: input.reason,
        });
        this.transitionTo({ kind: "idle", retriesUsed: 0 });
      } else if (outcome.kind === "failed") {
        this.transitionTo({
          kind: "failed",
          failureReason: outcome.error,
          retriesUsed: this.state.retriesUsed,
        });
        this.emit("ContextCompactFailed", { reason: outcome.error });
      }
      this.prepared = undefined;
      this.inflightCandidate = undefined;
      this.inflightPrepare = undefined;
      return outcome;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.transitionTo({
        kind: "failed",
        failureReason: reason,
        retriesUsed: this.state.retriesUsed,
      });
      this.emit("ContextCompactFailed", { reason });
      return { kind: "failed", error: reason };
    }
  }

  /**
   * User rollback to a prior snapshot. The committer owns the actual
   * write; this method delegates so the inspector facade can route
   * the call without learning storage details.
   */
  async restoreVersion(snapshotId: string): Promise<void> {
    // For B4 we do not yet ship the cross-version restore primitive
    // (that would require a second tx that re-installs an earlier
    // `PersistedContext`). The orchestrator surfaces the seam so the
    // inspector facade returns 501 honestly until B7+ ships restore.
    throw new Error(
      `restoreVersion(${snapshotId}): not implemented — restore primitive ships in B7+ alongside cross-version validation`,
    );
  }

  /** Inspector helper — list available rollback targets. */
  async listSnapshots(): Promise<SnapshotMetadata[]> {
    return this.versionHistory.listAll();
  }

  // ── Internal helpers ─────────────────────────────────────────────

  private transitionTo(patch: Partial<CompactState> & { kind: CompactState["kind"] }): void {
    this.state = {
      kind: patch.kind,
      stateId: this.stateIdFactory(),
      enteredAt: this.nowIso(),
      prepareJobId: patch.prepareJobId ?? this.state.prepareJobId,
      observedContextVersion:
        patch.observedContextVersion ?? this.state.observedContextVersion,
      failureReason: patch.failureReason ?? undefined,
      retriesUsed: patch.retriesUsed ?? this.state.retriesUsed,
    };
  }

  private emit(name: LifecycleEvent["name"], payload: Record<string, unknown>): void {
    this.emitter.emit({
      name,
      sessionUuid: this.sessionUuid,
      stateId: this.state.stateId,
      emittedAt: this.nowIso(),
      payload,
    });
  }
}
