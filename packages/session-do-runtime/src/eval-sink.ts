import type {
  EvalSinkEmitArgs,
  EvalSinkOverflowDisclosure,
  EvalSinkStats,
} from "@nano-agent/nacp-core";

/**
 * @deprecated Import sink contract types from `@nano-agent/nacp-core`.
 * Planned removal: worker-matrix P0 absorption phase (target 2026-Q3).
 */
export type {
  EvalSinkEmitArgs,
  EvalSinkOverflowDisclosure,
  EvalSinkStats,
} from "@nano-agent/nacp-core";
/**
 * @deprecated Import `extractMessageUuid` from `@nano-agent/nacp-core`.
 * Planned removal: worker-matrix P0 absorption phase (target 2026-Q3).
 */
export { extractMessageUuid } from "@nano-agent/nacp-core";

/**
 * Session DO Runtime — bounded-FIFO eval sink with B6 dedup + overflow
 * disclosure.
 *
 * Purpose: used as `subsystems.eval` when the composition factory does
 * not supply a richer sink (e.g. `DoStorageTraceSink`). Before B6 this
 * was a raw unbounded-append-then-splice array that silently dropped
 * FIFO records on overflow — violating `binding-F04` ("sink overflow
 * MUST emit explicit disclosure; silent drop is non-conformant").
 *
 * B6 contract (per `docs/rfc/nacp-core-1-2-0.md` §4.2 + action-plan §2.3):
 *
 *   1. **Bounded FIFO**. The sink has a hard capacity; arrival past
 *      that capacity is NOT silent.
 *   2. **Dedup by messageUuid**. Records carrying an envelope-level
 *      `messageUuid` are de-duplicated. Records without one pass
 *      through (backward compat).
 *   3. **Overflow disclosure**. An explicit `overflowCount` counter
 *      and a bounded ring buffer of recent overflow events are
 *      observable via `getDisclosure()`. Optional: an injected
 *      `onOverflow` callback lets the host emit the B5
 *      `EvalSinkOverflow` hook event.
 *   4. **Out-of-scope explicitly**: hashing bodies to synthesise a
 *      dedup key (false-positive risk too high); persistence across
 *      DO hibernation (in-memory default sink by design).
 *
 * The sink is transport-agnostic: records themselves are opaque
 * `unknown`. Dedup keys + overflow disclosures are the only structural
 * metadata the sink surfaces.
 */

export interface BoundedEvalSinkOptions {
  /** Hard record capacity. Defaults to 1024 (parity with pre-B6 behaviour). */
  readonly capacity?: number;
  /** Last-N ring buffer size for overflow disclosures. Defaults to 32. */
  readonly disclosureBufferSize?: number;
  /**
   * Optional B5 hook emission seam. When supplied, the sink invokes
   * this callback on each overflow / duplicate drop so the host can
   * emit an `EvalSinkOverflow` hook event. Errors thrown by the
   * callback are caught and ignored — observability never crashes the
   * eval path.
   */
  readonly onOverflow?: (disclosure: EvalSinkOverflowDisclosure) => void;
  /**
   * Clock override (mostly for tests). Returns an ISO timestamp per
   * call. Defaults to `new Date().toISOString()`.
   */
  readonly now?: () => string;
}

const DEFAULT_CAPACITY = 1024;
const DEFAULT_DISCLOSURE_BUFFER = 32;

/**
 * B6 — bounded FIFO eval sink with messageUuid dedup and overflow
 * disclosure. Used as the default `subsystems.eval` when the
 * composition factory leaves the handle unwired.
 *
 * **Bounded FIFO dedup window (B5-B6 review R1 fix, 2026-04-20)**:
 * the dedup horizon matches the currently-held FIFO window, not the
 * lifetime history. Each entry carries its `messageUuid` alongside
 * the record so capacity eviction can prune the corresponding `seen`
 * entry. Without this, `seen` grew unboundedly — evicted-then-seen-
 * again uuids were wrongly rejected and the Set held the entire
 * session's uuid history in Worker memory.
 */
interface SinkEntry {
  readonly record: unknown;
  readonly messageUuid?: string;
}

export class BoundedEvalSink {
  private readonly entries: SinkEntry[] = [];
  private readonly disclosures: EvalSinkOverflowDisclosure[] = [];
  private readonly seen = new Set<string>();
  private readonly capacity: number;
  private readonly disclosureBufferSize: number;
  private readonly onOverflow?: (d: EvalSinkOverflowDisclosure) => void;
  private readonly now: () => string;

  private capacityOverflowCount = 0;
  private duplicateDropCount = 0;
  private dedupEligibleCount = 0;
  private missingMessageUuidCount = 0;

  constructor(options: BoundedEvalSinkOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.disclosureBufferSize =
      options.disclosureBufferSize ?? DEFAULT_DISCLOSURE_BUFFER;
    this.onOverflow = options.onOverflow;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /**
   * Emit a record. Returns `true` if the record was stored; `false`
   * if it was dropped (either as a duplicate or because capacity
   * forced eviction — note: capacity-driven FIFO eviction is still
   * considered a successful append of the new record, but the OLDEST
   * record is dropped and disclosed).
   */
  emit(args: EvalSinkEmitArgs): boolean {
    const messageUuid =
      args.messageUuid !== undefined && args.messageUuid.length > 0
        ? args.messageUuid
        : undefined;

    // ── §1 duplicate check (only when a uuid is provided) ──
    if (messageUuid !== undefined) {
      if (this.seen.has(messageUuid)) {
        this.duplicateDropCount += 1;
        this.recordDisclosure({
          at: this.now(),
          reason: "duplicate-message",
          droppedCount: 1,
          capacity: this.capacity,
          messageUuid,
        });
        return false;
      }
      this.seen.add(messageUuid);
      this.dedupEligibleCount += 1;
    } else {
      this.missingMessageUuidCount += 1;
    }

    // ── §2 append entry (carries its uuid so eviction can prune `seen`) ──
    this.entries.push({ record: args.record, messageUuid });

    // ── §3 capacity eviction ──
    if (this.entries.length > this.capacity) {
      const evictionCount = this.entries.length - this.capacity;
      const evicted = this.entries.splice(0, evictionCount);
      for (const entry of evicted) {
        if (entry.messageUuid !== undefined) {
          this.seen.delete(entry.messageUuid);
        }
      }
      this.capacityOverflowCount += evictionCount;
      this.recordDisclosure({
        at: this.now(),
        reason: "capacity-exceeded",
        droppedCount: evictionCount,
        capacity: this.capacity,
      });
    }

    return true;
  }

  /** Snapshot of currently-held records (copy, not live reference). */
  getRecords(): readonly unknown[] {
    return this.entries.map((entry) => entry.record);
  }

  /** Snapshot of the overflow-disclosure ring buffer. */
  getDisclosure(): readonly EvalSinkOverflowDisclosure[] {
    return [...this.disclosures];
  }

  /** Observability counters. */
  getStats(): EvalSinkStats {
    return {
      recordCount: this.entries.length,
      capacity: this.capacity,
      capacityOverflowCount: this.capacityOverflowCount,
      duplicateDropCount: this.duplicateDropCount,
      totalOverflowCount:
        this.capacityOverflowCount + this.duplicateDropCount,
      dedupEligible: this.dedupEligibleCount,
      missingMessageUuid: this.missingMessageUuidCount,
    };
  }

  private recordDisclosure(disclosure: EvalSinkOverflowDisclosure): void {
    this.disclosures.push(disclosure);
    if (this.disclosures.length > this.disclosureBufferSize) {
      this.disclosures.splice(0, this.disclosures.length - this.disclosureBufferSize);
    }
    if (this.onOverflow) {
      try {
        this.onOverflow(disclosure);
      } catch {
        // observability never crashes emit path
      }
    }
  }
}
