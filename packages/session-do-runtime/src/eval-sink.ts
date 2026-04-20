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

/**
 * Arguments accepted by `emit()`.
 *
 * `messageUuid` is the envelope-level dedup key (per
 * `packages/nacp-session/src/websocket.ts::postStreamEvent`
 * where it lives on `session_frame.header.message_uuid`). When absent,
 * the record is recorded unconditionally — dedup is opt-in.
 */
export interface EvalSinkEmitArgs {
  readonly record: unknown;
  readonly messageUuid?: string;
}

/**
 * A single overflow-disclosure entry. The sink keeps the last N of
 * these (`disclosureBufferSize`) so an inspector can show the user
 * "you lost 12 records; most recent drop was at …".
 */
export interface EvalSinkOverflowDisclosure {
  readonly at: string;
  readonly reason: "capacity-exceeded" | "duplicate-message";
  readonly droppedCount: number;
  readonly capacity: number;
  readonly messageUuid?: string;
}

/**
 * Observability snapshot exposed to tests, inspector facade, and B7
 * integrated spike.
 */
export interface EvalSinkStats {
  /** Number of records currently held. */
  readonly recordCount: number;
  /** Hard capacity (constructor-provided). */
  readonly capacity: number;
  /** Total records ever dropped because capacity was exceeded. */
  readonly capacityOverflowCount: number;
  /** Total records dropped because their `messageUuid` was already seen. */
  readonly duplicateDropCount: number;
  /** Combined: `capacity + duplicate` drops. */
  readonly totalOverflowCount: number;
  /** Events that carried a `messageUuid` and were recorded. */
  readonly dedupEligible: number;
  /** Events emitted without a `messageUuid`. */
  readonly missingMessageUuid: number;
}

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
 */
export class BoundedEvalSink {
  private readonly records: unknown[] = [];
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
    const messageUuid = args.messageUuid;

    // ── §1 duplicate check (only when a uuid is provided) ──
    if (messageUuid !== undefined && messageUuid.length > 0) {
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

    // ── §2 append ──
    this.records.push(args.record);

    // ── §3 capacity eviction ──
    if (this.records.length > this.capacity) {
      const evictionCount = this.records.length - this.capacity;
      this.records.splice(0, evictionCount);
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
    return [...this.records];
  }

  /** Snapshot of the overflow-disclosure ring buffer. */
  getDisclosure(): readonly EvalSinkOverflowDisclosure[] {
    return [...this.disclosures];
  }

  /** Observability counters. */
  getStats(): EvalSinkStats {
    return {
      recordCount: this.records.length,
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

/**
 * Extract a best-effort `messageUuid` from whatever shape the record
 * happens to have. Current default sink callers pass either a raw
 * `TraceEvent` (no uuid) or an inspector-friendly wrapper. The
 * accessor checks the handful of shapes we've observed in practice:
 *
 *   - `{ messageUuid: "..." }`                      — direct field
 *   - `{ envelope: { header: { message_uuid } } }`  — full NACP frame
 *   - `{ header: { message_uuid } }`                — loose frame
 *
 * Returns `undefined` when nothing matches — opts the record out of
 * dedup per B6 contract.
 */
export function extractMessageUuid(record: unknown): string | undefined {
  if (record === null || typeof record !== "object") return undefined;
  const obj = record as Record<string, unknown>;

  if (typeof obj.messageUuid === "string" && obj.messageUuid.length > 0) {
    return obj.messageUuid;
  }
  if (typeof obj.message_uuid === "string" && (obj.message_uuid as string).length > 0) {
    return obj.message_uuid as string;
  }

  const envelope =
    obj.envelope !== null && typeof obj.envelope === "object"
      ? (obj.envelope as Record<string, unknown>)
      : undefined;
  const envelopeHeader =
    envelope &&
    envelope.header !== null &&
    typeof envelope.header === "object"
      ? (envelope.header as Record<string, unknown>)
      : undefined;
  if (
    envelopeHeader &&
    typeof envelopeHeader.message_uuid === "string" &&
    (envelopeHeader.message_uuid as string).length > 0
  ) {
    return envelopeHeader.message_uuid as string;
  }

  const header =
    obj.header !== null && typeof obj.header === "object"
      ? (obj.header as Record<string, unknown>)
      : undefined;
  if (
    header &&
    typeof header.message_uuid === "string" &&
    (header.message_uuid as string).length > 0
  ) {
    return header.message_uuid as string;
  }

  return undefined;
}
