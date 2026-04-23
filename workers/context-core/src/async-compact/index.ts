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
 * The orchestrator is **stateful in-memory** for the current turn AND
 * **persists ARMED / PREPARING / FAILED** to DO storage so a worker
 * eviction can recover (per PX spec §2.3). Callers must invoke
 * `await orchestrator.hydrate()` once after construction so the
 * in-memory state matches the persisted record before the first
 * `tryArm` / `tryPrepare` / `tryCommit` call.
 *
 * State machine extensions (post-GPT review fixes B4-R1/R2/R4):
 *
 *   - **Generation token (B4-R4)** — every transition that resets the
 *     compact lifecycle (commit / fallback / hydrate-restart) bumps
 *     `this.generation`. Background prepare promises capture the
 *     generation at dispatch and refuse to mutate state when the
 *     captured token no longer matches; this prevents an in-flight
 *     prepare from poisoning a successful fallback.
 *   - **Retry budget (B4-R2)** — `transitionTo({ kind: "failed" })`
 *     increments `retriesUsed`. `tryArm` accepts entry from `failed`
 *     when `retriesUsed < policy.maxRetriesAfterFailure`; once the
 *     budget is exhausted the orchestrator emits
 *     `ContextCompactFailed` with `terminal: true` and refuses
 *     further `tryArm` until an explicit `resetAfterFailure()` call
 *     (operator / inspector intervention).
 *   - **Persistence (B4-R1)** — `armed`, `preparing`, `failed` records
 *     are written to DO storage `compact-state:{sessionUuid}` via a
 *     single-key `DOStorageAdapter.put(...)` (atomic per key on its
 *     own; cross-key atomicity is only needed for the actual swap,
 *     which the committer wraps in `state.storage.transaction()`).
 *     `hydrate()` reads the same key on cold start. `committed` /
 *     `idle` are transient-only (not persisted) and the committer's
 *     `tx.delete(compactStateKey)` clears the record on successful
 *     swap. **Failure mode is warn-and-swallow** — see `persistState`
 *     JSDoc for the per-state degradation analysis (durable
 *     best-effort, not hard guarantee).
 */

import type {
  DOStorageAdapter,
  R2Adapter,
} from "@nano-agent/storage-topology";
import type { ContextLayer } from "../context-layers.js";

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
/** DO storage key for the persisted compact-state record. */
function compactStateKeyOf(sessionUuid: string): string {
  return `compact-state:${sessionUuid}`;
}

export class AsyncCompactOrchestrator {
  private readonly sessionUuid: string;
  private readonly doStorage: DOStorageAdapter;
  private readonly r2: R2Adapter | undefined;
  private readonly policy: CompactPolicy;
  private readonly emitter: LifecycleEventEmitter;
  private readonly nowIso: () => string;
  private readonly stateIdFactory: () => string;
  private readonly compactStateKey: string;

  private readonly scheduler: CompactionScheduler;
  private readonly planner: CompactionPlanner;
  private readonly prepareJob: PrepareJob;
  private readonly committer: CompactionCommitter;
  private readonly versionHistory: VersionHistory;
  private readonly fallback: FallbackController;

  private state: CompactState;
  private prepared: PreparedSummary | undefined;
  private inflightPrepare: Promise<PreparedSummary | null> | undefined;
  private inflightCandidate: ContextCandidate | undefined;
  /**
   * Generation token (B4-R4 fix). Incremented on every event that
   * concludes a compact lifecycle iteration (commit success / fallback
   * success / explicit reset / hydrate). A captured generation lets
   * background callbacks tell whether they still own the state.
   */
  private generation: number;
  private hydrated: boolean;
  /** True once the retry budget is exhausted; cleared by `resetAfterFailure()`. */
  private terminalFailed: boolean;

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
    this.compactStateKey = compactStateKeyOf(this.sessionUuid);

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
    this.generation = 0;
    this.hydrated = false;
    this.terminalFailed = false;
  }

  // ── Hydrate / persist (B4-R1) ────────────────────────────────────

  /**
   * Restore in-memory state from the DO-persisted compact-state record.
   * Idempotent — calling more than once is a no-op after the first
   * successful load.
   *
   * Recovery rules (per PX spec §2.4):
   *   - `armed`     → re-arm scheduler (state restored verbatim).
   *   - `preparing` → emit `ContextCompactPrepareInterrupted`-shape
   *     warning (we use the existing `ContextCompactFailed` channel
   *     with `reason="preparing-interrupted-by-eviction"` so the
   *     handler doesn't need a new event name); state moves to
   *     `failed` so the retry budget can decide next steps.
   *   - `failed`    → restore as failed; terminal is computed using
   *     the SAME predicate as live `recordFailure` (R8 / GPT 2nd
   *     review §C.1 fix): `retriesUsed > maxRetriesAfterFailure`
   *     (NOT `>= cap`). With `cap = 1`, a session that crashed
   *     after using 1 of its 1 allowed retries still rehydrates as
   *     non-terminal and may attempt one more arm. Without this
   *     symmetry, eviction silently changed the retry budget
   *     semantics across worker restarts.
   *   - missing     → state stays at the constructor default `idle`.
   */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    const persisted = await this.doStorage.get<PersistedCompactStateRecord>(
      this.compactStateKey,
    );
    if (!persisted) return;
    this.generation = (persisted.generation ?? 0) + 1;
    if (persisted.kind === "preparing") {
      // The previous worker died mid-prepare; we cannot recover the
      // in-flight LLM call. Move to `failed` so the retry budget can
      // run.
      this.state = {
        kind: "failed",
        stateId: this.stateIdFactory(),
        enteredAt: this.nowIso(),
        retriesUsed: persisted.retriesUsed,
        failureReason: "preparing-interrupted-by-eviction",
      };
      this.terminalFailed = this.isTerminalRetries(this.state.retriesUsed);
      this.emit("ContextCompactFailed", {
        reason: "preparing-interrupted-by-eviction",
        terminal: this.terminalFailed,
        retriesUsed: this.state.retriesUsed,
      });
      await this.persistState();
      return;
    }
    this.state = {
      kind: persisted.kind,
      stateId: this.stateIdFactory(),
      enteredAt: this.nowIso(),
      prepareJobId: persisted.prepareJobId,
      observedContextVersion: persisted.observedContextVersion,
      failureReason: persisted.failureReason,
      retriesUsed: persisted.retriesUsed,
    };
    if (persisted.kind === "failed") {
      this.terminalFailed = this.isTerminalRetries(persisted.retriesUsed);
    }
  }

  /**
   * Single source-of-truth for the "is terminal?" predicate used by
   * BOTH `hydrate()` and `recordFailure()`. R8 fix: kept on a method
   * so any future tweak (e.g. exposing terminal-check as a public
   * read) lands in one place.
   *
   * Semantics: `retriesUsed` counts the number of failures that have
   * landed; `maxRetriesAfterFailure` is the allowed RETRY budget on
   * top of the first failure. So with `cap = 1`:
   *   - 1 failure  → 1 retry budget remains → `1 > 1` is false → not terminal
   *   - 2 failures → budget exhausted        → `2 > 1` is true  → terminal
   */
  private isTerminalRetries(retriesUsed: number): boolean {
    return retriesUsed > this.policy.maxRetriesAfterFailure;
  }

  /**
   * Operator / inspector escape hatch — clears `terminalFailed` and
   * returns the orchestrator to `idle` so a fresh `tryArm` can run.
   * Resets the persisted record. Caller decides when this is safe.
   */
  async resetAfterFailure(): Promise<void> {
    this.generation += 1;
    this.terminalFailed = false;
    this.prepared = undefined;
    this.inflightCandidate = undefined;
    this.inflightPrepare = undefined;
    this.state = {
      kind: "idle",
      stateId: this.stateIdFactory(),
      enteredAt: this.nowIso(),
      retriesUsed: 0,
    };
    await this.clearPersistedState();
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

  /**
   * Read-only snapshot for inspector consumption.
   *
   * **B4-R7 fix**: this is a synchronous "best-effort in-memory view".
   * `currentContextVersion` is the version observed by the most recent
   * commit / hydrate (`state.observedContextVersion`); it MAY lag the
   * persisted truth between commits. Callers wanting fresh truth from
   * DO storage must use `getCurrentStateAsync()` which runs a real
   * read.
   */
  getCurrentState(): CompactStateSnapshot {
    return {
      state: this.state,
      currentContextVersion: this.state.observedContextVersion ?? 0,
      preparedSummary: this.prepared
        ? {
            bytes: this.prepared.sizeBytes,
            snapshotVersion: this.prepared.snapshotVersion,
          }
        : undefined,
    };
  }

  /**
   * Async variant: also reads the persisted context to surface the
   * authoritative `currentContextVersion`. Inspector facade should
   * prefer this when serving `/inspect/.../compact-state`.
   */
  async getCurrentStateAsync(): Promise<CompactStateSnapshot> {
    const snapshot = this.getCurrentState();
    const persisted = await this.committer.readPersisted();
    return {
      ...snapshot,
      currentContextVersion: persisted?.version ?? snapshot.currentContextVersion,
    };
  }

  // ── Write API ────────────────────────────────────────────────────

  /**
   * Idempotent ARM transition.
   *
   * Accepts entry from `idle` (the canonical path) **and** from
   * `failed` when the retry budget is not yet exhausted (B4-R2 fix).
   * Other states are a no-op (per PX spec singleton invariant).
   */
  async tryArm(usage: UsageSnapshot): Promise<void> {
    if (this.terminalFailed) return;
    if (this.state.kind === "idle") {
      if (!this.shouldArm(usage)) return;
      // B5 — `ContextPressure` early-signal hooks fire before the
      // state-machine transition so observers see "we're about to
      // arm because usage is at X%" separately from the actual
      // arming transition.
      const usagePct = usage.totalTokens / Math.max(1, usage.maxTokens);
      this.emit("ContextPressure", { usagePct, nextAction: "arm" });
      await this.transitionTo({ kind: "armed", retriesUsed: 0 });
      this.emit("ContextCompactArmed", { usagePct });
      return;
    }
    if (this.state.kind === "failed") {
      // Retry path. Caller MUST have observed enough headroom that
      // the soft threshold is again crossed (it was crossed once
      // already, so this is usually true). The retry counter is
      // preserved so a second failure exhausts the budget honestly.
      if (!this.shouldArm(usage)) return;
      const usagePct = usage.totalTokens / Math.max(1, usage.maxTokens);
      this.emit("ContextPressure", {
        usagePct,
        nextAction: "arm",
        retry: true,
      });
      await this.transitionTo({
        kind: "armed",
        retriesUsed: this.state.retriesUsed,
      });
      this.emit("ContextCompactArmed", {
        usagePct,
        retry: true,
        retriesUsed: this.state.retriesUsed,
      });
    }
  }

  /**
   * Drives ARMED → PREPARING by spawning the background summarization
   * job. Returns immediately; the prepared summary is later picked
   * up by `tryCommit`.
   *
   * **B4-R4 fix** — captures `this.generation` before dispatching
   * the background promise. The completion handlers refuse to mutate
   * orchestrator state when the captured generation no longer matches
   * (i.e. a `forceSyncCompact()` / commit / explicit reset has bumped
   * the generation), so a stale prepare cannot poison a fresh state.
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
    const dispatchedGeneration = this.generation;
    void this.transitionTo({ kind: "preparing", prepareJobId }).then(() => {
      this.emit("ContextCompactPrepareStarted", {
        prepareJobId,
        snapshotVersion: candidate.snapshotVersion,
        tokenEstimate: candidate.tokenEstimate,
      });
    });

    this.inflightPrepare = this.prepareJob
      .run({ candidate, sessionUuid: this.sessionUuid })
      .then((prepared) => {
        if (this.generation !== dispatchedGeneration) {
          // Stale completion — orchestrator already advanced past
          // this prepare iteration (e.g. forceSyncCompact ran).
          return null;
        }
        this.prepared = prepared;
        return prepared;
      })
      .catch(async (err: unknown) => {
        if (this.generation !== dispatchedGeneration) {
          // Stale failure — drop on the floor. The current generation
          // owns the state; we are not allowed to flip it to `failed`.
          return null;
        }
        const reason =
          err instanceof PrepareJobTimeoutError
            ? `timeout-${err.timeoutMs}ms`
            : err instanceof Error
              ? err.message
              : String(err);
        await this.recordFailure(reason);
        this.inflightPrepare = undefined;
        // Resolve to a sentinel `null` so awaiters can detect the
        // failure without an unhandled rejection.
        return null;
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

    await this.transitionTo({ kind: "committing" });

    const outcome = await this.committer.commit({ candidate, prepared });
    if (outcome.kind === "committed") {
      // B4-R4 — bump generation BEFORE clearing inflight refs so any
      // late prepare-callback (already-resolved happy path is harmless,
      // but a later .catch from a parallel prepare would be poison).
      this.generation += 1;
      await this.transitionTo({
        kind: "committed",
        observedContextVersion: outcome.newVersion,
      });
      this.emit("ContextCompactCommitted", {
        oldVersion: outcome.oldVersion,
        newVersion: outcome.newVersion,
        summary: outcome.summary,
      });
      await this.transitionTo({ kind: "idle", retriesUsed: 0 });
      await this.clearPersistedState();
      this.prepared = undefined;
      this.inflightCandidate = undefined;
      this.inflightPrepare = undefined;
    } else if (outcome.kind === "failed") {
      await this.recordFailure(outcome.error);
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
    // B4-R4 — bump generation NOW so any in-flight prepare promise
    // sees a stale generation when it eventually resolves and refuses
    // to mutate state.
    this.generation += 1;
    await this.transitionTo({ kind: "committing" });
    try {
      const outcome = await this.fallback.runSync({
        layers: input.layers,
        contextVersion: input.contextVersion,
        reason: input.reason,
      });
      if (outcome.kind === "committed") {
        await this.transitionTo({
          kind: "committed",
          observedContextVersion: outcome.newVersion,
        });
        this.emit("ContextCompactCommitted", {
          oldVersion: outcome.oldVersion,
          newVersion: outcome.newVersion,
          summary: outcome.summary,
          reason: input.reason,
        });
        await this.transitionTo({ kind: "idle", retriesUsed: 0 });
        await this.clearPersistedState();
      } else if (outcome.kind === "failed") {
        await this.recordFailure(outcome.error);
      }
      this.prepared = undefined;
      this.inflightCandidate = undefined;
      this.inflightPrepare = undefined;
      return outcome;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.recordFailure(reason);
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

  private async transitionTo(
    patch: Partial<CompactState> & { kind: CompactState["kind"] },
  ): Promise<void> {
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
    // Persist the durable kinds; transient kinds intentionally don't
    // hit DO storage — `committed`/`committing`/`idle` only flow inside
    // a single in-memory invocation, and `idle` is represented by
    // absence (the committer's own tx already deletes the record).
    if (this.state.kind === "armed" || this.state.kind === "preparing" || this.state.kind === "failed") {
      await this.persistState();
    }
  }

  /**
   * Move to `failed` and increment the retry counter (B4-R2 fix).
   * Marks the orchestrator terminal once `retriesUsed > cap` (R8 fix:
   * the predicate now matches `hydrate()` so eviction does not change
   * the budget semantics). Always persists the new state so cold
   * restarts see the same retry count.
   */
  private async recordFailure(reason: string): Promise<void> {
    const nextRetries = this.state.retriesUsed + 1;
    const terminal = this.isTerminalRetries(nextRetries);
    this.terminalFailed = terminal;
    await this.transitionTo({
      kind: "failed",
      failureReason: reason,
      retriesUsed: nextRetries,
    });
    this.emit("ContextCompactFailed", {
      reason,
      retriesUsed: nextRetries,
      retryBudget: this.policy.maxRetriesAfterFailure,
      terminal,
    });
  }

  /**
   * Best-effort durable write of the compact-state record (GPT 2nd
   * review §D honesty fix).
   *
   * Mechanism: a single-key `DOStorageAdapter.put(...)` — NOT a
   * `state.storage.transaction()` wrapper. Single-key DO writes are
   * atomic per key on their own; we only need a transaction when
   * mutating multiple keys atomically (the committer is the only
   * site in B4 that needs that, and it does use one). Earlier
   * `index.ts` JSDoc and `B2-B4-code-reviewed-by-GPT.md §6.2 R1`
   * over-claimed this as "via state.storage.transaction" — that
   * wording is corrected here.
   *
   * Failure handling: warn-and-swallow. Rationale per call-site:
   *   - `armed` not persisted → eviction returns to `idle`; the next
   *     turn re-arms. Soft loss; no corruption.
   *   - `preparing` not persisted → eviction loses the in-flight
   *     prepare reference; next hydrate sees nothing and the next
   *     turn restarts the lifecycle. No corruption.
   *   - `failed` not persisted → eviction forgets the failure → the
   *     retry counter resets. Over-counts retries on the GENEROUS
   *     side (the user gets MORE retries than `maxRetriesAfterFailure`
   *     guarantees). No corruption, just a slightly relaxed budget
   *     after a crash.
   *
   * In short: durable best-effort, not hard guarantee. If the in-tx
   * commit succeeds the persisted record is irrelevant (committer
   * already deleted it). If a critical DO write begins to fail
   * persistently, the operator will see the warn output AND the
   * orchestrator will continue to function via in-memory state for
   * the current invocation; only cross-eviction continuity is at
   * risk.
   */
  private async persistState(): Promise<void> {
    const record: PersistedCompactStateRecord = {
      kind: this.state.kind as PersistedKind,
      retriesUsed: this.state.retriesUsed,
      generation: this.generation,
      enteredAt: this.state.enteredAt,
      prepareJobId: this.state.prepareJobId,
      observedContextVersion: this.state.observedContextVersion,
      failureReason: this.state.failureReason,
    };
    try {
      await this.doStorage.put(this.compactStateKey, record);
    } catch (err) {
      console.warn(
        `AsyncCompactOrchestrator.persistState: ${describeError(err)}`,
      );
    }
  }

  private async clearPersistedState(): Promise<void> {
    try {
      await this.doStorage.delete(this.compactStateKey);
    } catch (err) {
      console.warn(
        `AsyncCompactOrchestrator.clearPersistedState: ${describeError(err)}`,
      );
    }
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

// ═══════════════════════════════════════════════════════════════════
// §3 — Persistence record shape (B4-R1)
// ═══════════════════════════════════════════════════════════════════

type PersistedKind = "armed" | "preparing" | "failed";

/**
 * Persisted shape under DO key `compact-state:{sessionUuid}`. Kept
 * narrow on purpose: only the fields needed to rehydrate the state
 * machine on cold restart. `stateId` is regenerated on hydrate (it is
 * an in-memory monotonic identifier, not a stable cross-restart id).
 */
interface PersistedCompactStateRecord {
  readonly kind: PersistedKind;
  readonly retriesUsed: number;
  readonly generation: number;
  readonly enteredAt: string;
  readonly prepareJobId?: string;
  readonly observedContextVersion?: number;
  readonly failureReason?: string;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
