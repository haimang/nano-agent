/**
 * Context-Management — async-compact FallbackController.
 *
 * Per `PX-async-compact-lifecycle-spec.md §6`: when token usage hits
 * `HARD_THRESHOLD` (~95%) and no prepared summary exists, the
 * orchestrator falls back to **synchronous compact**:
 *
 *   - Block the current turn at the next safe boundary
 *   - Run summarization synchronously inside the same worker
 *     invocation
 *   - Reuse the same `CompactionPlanner` + `PrepareJob` + committer
 *     primitives so the resulting state is byte-for-byte equivalent
 *     to the async path
 *
 * This is deliberately a **separate file** so the graceful-degradation
 * path is callable directly (e.g. from `forceSyncCompact`) and reads
 * differently in code review than the primary async path.
 */

import { CompactionCommitter } from "./committer.js";
import { CompactionPlanner } from "./planner.js";
import { PrepareJob } from "./prepare-job.js";
import type {
  CommitOutcome,
  ContextCandidate,
  LlmSummarizeProvider,
} from "./types.js";

export interface FallbackControllerConfig {
  readonly sessionUuid: string;
  readonly provider: LlmSummarizeProvider;
  readonly committer: CompactionCommitter;
  readonly planner?: CompactionPlanner;
  /** Synchronous fallback usually allows a tighter timeout — defaults to 60s. */
  readonly timeoutMs?: number;
  readonly idFactory?: () => string;
}

export class FallbackController {
  private readonly sessionUuid: string;
  private readonly committer: CompactionCommitter;
  private readonly planner: CompactionPlanner;
  private readonly prepareJob: PrepareJob;

  constructor(config: FallbackControllerConfig) {
    this.sessionUuid = config.sessionUuid;
    this.committer = config.committer;
    this.planner = config.planner ?? new CompactionPlanner();
    this.prepareJob = new PrepareJob({
      provider: config.provider,
      timeoutMs: config.timeoutMs ?? 60_000,
      idFactory: config.idFactory,
    });
  }

  /** Run the synchronous compact path end-to-end. */
  async runSync(input: {
    layers: ContextCandidate["layers"];
    contextVersion: number;
    reason: string;
  }): Promise<CommitOutcome> {
    const candidate = this.planner.fork({
      layers: input.layers,
      contextVersion: input.contextVersion,
    });
    const prepared = await this.prepareJob.run({
      candidate,
      sessionUuid: this.sessionUuid,
    });
    return this.committer.commit({ candidate, prepared });
  }
}
