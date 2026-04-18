/**
 * @nano-agent/eval-observability — DO storage trace sink.
 *
 * Append-only JSONL storage, per-session, tenant-scoped. Each event is
 * appended as a single JSON line keyed by
 * `tenants/{teamUuid}/trace/{sessionUuid}/{YYYY-MM-DD}.jsonl`.
 *
 * The sink also maintains a small durable index entry
 * (`tenants/{teamUuid}/trace/{sessionUuid}/_index`) containing the set of
 * date-keys that have been written to. The index makes `readTimeline()`
 * hibernation-safe: a brand-new sink instance (e.g. after DO restart)
 * can read the index and enumerate historical data keys without needing
 * a `list(prefix)` capability on the underlying storage.
 *
 * Uses `shouldPersist()` to gate — live-only events are silently dropped.
 */

import type { TraceEvent } from "../trace-event.js";
import type { TraceSink } from "../sink.js";
import { shouldPersist } from "../classification.js";
import type { EvidenceSink } from "../evidence-streams.js";

/**
 * Minimal storage interface matching the subset of Cloudflare
 * DurableObjectStorage used by this sink. Allows easy test doubles.
 *
 * `list(prefix)` is optional — when present it enables key enumeration
 * without relying on the durable index. When absent, `readTimeline()`
 * falls back to reading the persisted `_index` entry.
 */
export interface DoStorageLike {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
  list?(prefix: string): Promise<string[]>;
}

/** Default maximum number of events buffered before an automatic flush. */
const DEFAULT_MAX_BUFFER_SIZE = 64;

/**
 * A TraceSink that persists events as append-only JSONL in DO storage.
 *
 * Storage key pattern: `tenants/{teamUuid}/trace/{sessionUuid}/{YYYY-MM-DD}.jsonl`
 * Each `emit` appends one JSON line. Events that fail `shouldPersist()`
 * are silently dropped. A companion index key
 * `tenants/{teamUuid}/trace/{sessionUuid}/_index` stores a JSON array of
 * date-keys that have been written, so a new sink instance can reconstruct
 * the full timeline across hibernations.
 */
export class DoStorageTraceSink implements TraceSink {
  private buffer: TraceEvent[] = [];
  private readonly maxBufferSize: number;
  private readonly prefix: string;
  private readonly indexKey: string;
  private readonly evidenceSink: EvidenceSink | undefined;

  constructor(
    private readonly storage: DoStorageLike,
    private readonly teamUuid: string,
    private readonly sessionUuid: string,
    options?: {
      maxBufferSize?: number;
      /**
       * Optional Phase 6 evidence sink (A7 P2-01). When supplied, every
       * real `storage.put()` call produced by `flush()` emits a typed
       * `PlacementEvidence` record so calibration / verdict bundles can
       * see the runtime placement decisions.
       */
      evidenceSink?: EvidenceSink;
    },
  ) {
    this.maxBufferSize = options?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
    this.prefix = `tenants/${this.teamUuid}/trace/${this.sessionUuid}/`;
    this.indexKey = `${this.prefix}_index`;
    this.evidenceSink = options?.evidenceSink;
  }

  /** Emit a trace event. Non-durable events are silently dropped. */
  async emit(event: TraceEvent): Promise<void> {
    if (!shouldPersist(event.eventKind)) {
      return;
    }

    this.buffer.push(event);

    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush();
    }
  }

  /** Flush all buffered events to storage. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    // Group buffered events by date key.
    const groups = new Map<string, TraceEvent[]>();
    for (const event of this.buffer) {
      const key = this.storageKey(event);
      let list = groups.get(key);
      if (!list) {
        list = [];
        groups.set(key, list);
      }
      list.push(event);
    }

    this.buffer = [];

    // Read the persistent date index once per flush cycle.
    const knownDates = new Set(await this.readIndex());

    // Append each group to its storage key and update the index.
    for (const [key, events] of groups) {
      const newLines = events.map((e) => JSON.stringify(e)).join("\n");
      const existing = await this.storage.get(key);
      const value = existing ? `${existing}\n${newLines}` : newLines;
      const t0 = Date.now();
      await this.storage.put(key, value);
      const durationMs = Date.now() - t0;
      knownDates.add(dateFromKey(key));
      this.emitPlacement({
        key,
        sizeBytes: value.length,
        durationMs,
        eventCount: events.length,
        firstEvent: events[0],
      });
    }

    await this.writeIndex([...knownDates].sort());
  }

  /** Emit one A7 placement-evidence record per real `storage.put()`. */
  private emitPlacement(args: {
    key: string;
    sizeBytes: number;
    durationMs: number;
    eventCount: number;
    firstEvent: TraceEvent | undefined;
  }): void {
    if (!this.evidenceSink) return;
    const first = args.firstEvent;
    void this.evidenceSink.emit({
      stream: "placement",
      anchor: {
        traceUuid: first?.traceUuid ?? "00000000-0000-4000-8000-000000000000",
        sessionUuid: this.sessionUuid,
        teamUuid: this.teamUuid,
        sourceRole: first?.sourceRole ?? "session",
        sourceKey: first?.sourceKey ?? "nano-agent.eval.do-storage-sink@v1",
        turnUuid: first?.turnUuid,
        timestamp: new Date().toISOString(),
      },
      dataItem: "trace.timeline",
      backend: "do-storage",
      op: "write",
      key: args.key,
      sizeBytes: args.sizeBytes,
      durationMs: args.durationMs,
      outcome: "ok",
      note: `flushed ${args.eventCount} events`,
    });
  }

  /**
   * Read back all trace events for this session, across all date keys.
   *
   * This is hibernation-safe: it reads the persisted date index to
   * enumerate keys, then fetches each. The caller does not need to have
   * kept the sink alive between writes and reads.
   */
  async readTimeline(): Promise<TraceEvent[]> {
    // Flush any pending events first so the read is consistent.
    await this.flush();

    const events: TraceEvent[] = [];
    const keys = await this.enumerateDataKeys();

    for (const key of keys) {
      const raw = await this.storage.get(key);
      if (raw) {
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (trimmed) {
            events.push(JSON.parse(trimmed) as TraceEvent);
          }
        }
      }
    }

    // Sort by timestamp for consistent ordering.
    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return events;
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  /** Derive the storage key for an event. */
  private storageKey(event: TraceEvent): string {
    const date = event.timestamp.slice(0, 10); // "YYYY-MM-DD"
    return `${this.prefix}${date}.jsonl`;
  }

  /** Read the persisted date index (array of YYYY-MM-DD strings). */
  private async readIndex(): Promise<string[]> {
    const raw = await this.storage.get(this.indexKey);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string");
      }
      return [];
    } catch {
      return [];
    }
  }

  /** Write the date index. */
  private async writeIndex(dates: readonly string[]): Promise<void> {
    await this.storage.put(this.indexKey, JSON.stringify(dates));
  }

  /**
   * Enumerate all data keys for this session. Prefers `storage.list(prefix)`
   * when available; falls back to the persisted date index otherwise.
   */
  private async enumerateDataKeys(): Promise<string[]> {
    if (typeof this.storage.list === "function") {
      const all = await this.storage.list(this.prefix);
      return all
        .filter((k) => k !== this.indexKey)
        .sort();
    }
    const dates = await this.readIndex();
    return dates.map((d) => `${this.prefix}${d}.jsonl`);
  }
}

/** Extract the date portion from a fully-qualified data key. */
function dateFromKey(key: string): string {
  // key ends with "{YYYY-MM-DD}.jsonl"
  const match = key.match(/(\d{4}-\d{2}-\d{2})\.jsonl$/);
  return match ? match[1] : key;
}
