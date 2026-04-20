/**
 * Context-Management — async-compact PrepareJob.
 *
 * Wraps a single background LLM summarization call:
 *   - Honours the `BACKGROUND_TIMEOUT_MS` budget by aborting via
 *     `AbortController`.
 *   - Returns a `PreparedSummary` with byte-length already computed
 *     so the committer can size-route DO vs R2 without re-encoding.
 *   - Surfaces timeout and error distinctly so the orchestrator can
 *     decide whether to retry or fall back to sync compact.
 */

import type {
  ContextCandidate,
  LlmSummarizeProvider,
  PreparedSummary,
} from "./types.js";

const TEXT_ENCODER = new TextEncoder();

export class PrepareJobTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`PrepareJob: background LLM exceeded ${timeoutMs}ms`);
    this.name = "PrepareJobTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export interface PrepareJobConfig {
  readonly provider: LlmSummarizeProvider;
  readonly timeoutMs: number;
  /** Injectable id factory; tests pin it for deterministic snapshots. */
  readonly idFactory?: () => string;
}

export class PrepareJob {
  private readonly provider: LlmSummarizeProvider;
  private readonly timeoutMs: number;
  private readonly idFactory: () => string;

  constructor(config: PrepareJobConfig) {
    this.provider = config.provider;
    this.timeoutMs = config.timeoutMs;
    this.idFactory =
      config.idFactory ??
      (() => `prep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  }

  /**
   * Run the background summarization. Throws `PrepareJobTimeoutError`
   * if the provider does not return within `timeoutMs`. Other errors
   * propagate unchanged.
   */
  async run(args: {
    candidate: ContextCandidate;
    sessionUuid: string;
  }): Promise<PreparedSummary> {
    const prepareJobId = this.idFactory();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const result = await this.provider.summarize({
        candidate: args.candidate,
        sessionUuid: args.sessionUuid,
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        throw new PrepareJobTimeoutError(this.timeoutMs);
      }

      const sizeBytes = TEXT_ENCODER.encode(result.text).byteLength;

      return {
        prepareJobId,
        snapshotVersion: args.candidate.snapshotVersion,
        text: result.text,
        sizeBytes,
        producedAt: new Date().toISOString(),
      };
    } catch (err) {
      if (controller.signal.aborted) {
        throw new PrepareJobTimeoutError(this.timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
