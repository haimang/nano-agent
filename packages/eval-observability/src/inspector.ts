/**
 * @nano-agent/eval-observability — real-time session inspector.
 *
 * Strictly consumes the 9 canonical `session.stream.event` kinds defined
 * in `@nano-agent/nacp-session` and provides filterable, chronological
 * access to the observed stream.
 *
 * The inspector is the WebSocket-first observer: it records whatever the
 * live WS connection produces. HTTP-fallback durable reads are provided
 * by `SessionTimeline.fromSink(...)` — the two views can be joined
 * downstream when needed.
 */

/**
 * The 9 canonical `session.stream.event` kinds.
 *
 * Mirrored locally rather than depending on `@nano-agent/nacp-session`
 * to avoid pulling Session profile code into the observability surface.
 * The catalog MUST stay in lock-step with
 * `packages/nacp-session/src/stream-event.ts`; a drift check test
 * (see `test/inspector.test.ts`) guards against divergence.
 */
export const SESSION_STREAM_EVENT_KINDS = [
  "tool.call.progress",
  "tool.call.result",
  "hook.broadcast",
  "session.update",
  "turn.begin",
  "turn.end",
  "compact.notify",
  "system.notify",
  "llm.delta",
] as const;

export type SessionStreamEventKind = (typeof SESSION_STREAM_EVENT_KINDS)[number];

/**
 * Runtime set for membership checks. Using a Set keeps `isValidKind`
 * O(1) and reusable.
 */
const KIND_SET: ReadonlySet<string> = new Set(SESSION_STREAM_EVENT_KINDS);

/** Returns true iff `kind` is one of the 9 canonical kinds. */
export function isSessionStreamEventKind(
  kind: string,
): kind is SessionStreamEventKind {
  return KIND_SET.has(kind);
}

/**
 * Optional per-event metadata carried from the NACP envelope.
 *
 * B6 (§4.2 of `docs/rfc/nacp-core-1-2-0.md`) dedup contract: the
 * authoritative `messageUuid` lives on the NACP envelope **header**
 * (`session_frame.header.message_uuid` per
 * `packages/nacp-session/src/websocket.ts`). It does NOT live in the
 * `session.stream.event` body. Callers that have the frame available
 * pass the extracted value here so the inspector can hard-dedup.
 */
export interface InspectorEventMeta {
  readonly messageUuid?: string;
}

/** A single event observed by the inspector. */
export interface InspectorEvent {
  readonly kind: SessionStreamEventKind;
  readonly seq: number;
  readonly timestamp: string;
  readonly body: unknown;
  /**
   * B6: the envelope-level `messageUuid` for the frame that produced
   * this event, when supplied by the caller. Undefined on events that
   * were fed via `onStreamEvent(...)` without `meta`.
   */
  readonly messageUuid?: string;
}

/** Diagnostic record for an event that failed validation. */
export interface InspectorRejection {
  readonly kind: string;
  readonly seq: number;
  readonly timestamp: string;
  readonly reason: "unknown-kind" | "invalid-body" | "duplicate-message";
  readonly body: unknown;
  readonly messageUuid?: string;
}

/**
 * Dedup statistics exposed for inspector health checks / B7 validation.
 */
export interface InspectorDedupStats {
  /** Events that passed validation AND had a `messageUuid`. */
  readonly dedupEligible: number;
  /** Events dropped because their `messageUuid` was already seen. */
  readonly duplicatesDropped: number;
  /** Events without a `messageUuid` (opted out of dedup). */
  readonly missingMessageUuid: number;
}

/**
 * Loose NACP session frame shape used by `onSessionFrame()`.
 *
 * Intentionally structural (not a hard import from nacp-session) so
 * `eval-observability` does not reverse-depend on Session profile
 * code. Mirrors the envelope / frame shape emitted by
 * `packages/nacp-session/src/websocket.ts`.
 */
export interface InspectorLikeSessionFrame {
  readonly header?: { readonly message_uuid?: string } | undefined;
  readonly body?: unknown;
  readonly session_frame?:
    | {
        readonly stream_uuid?: string;
        readonly stream_seq?: number;
      }
    | undefined;
}

/**
 * Real-time session inspector that accumulates stream events.
 *
 * Events are stored in arrival order and can be queried by kind or
 * recency. The inspector is append-only — events cannot be removed
 * once recorded. Events whose kind is not in the canonical 9-kind
 * catalog are rejected (never silently accepted); optional body
 * validation is delegated via `bodyValidator`, letting callers plug
 * in `SessionStreamEventBodySchema.safeParse` without this package
 * importing Session profile code.
 *
 * **B6 additions**:
 *
 * - Optional `meta.messageUuid` on `onStreamEvent()`. When present,
 *   the inspector performs **hard dedup**: a repeat `messageUuid` is
 *   dropped and recorded in `getRejections()` with
 *   `reason: "duplicate-message"`.
 * - `onSessionFrame(frame)` convenience: extracts
 *   `header.message_uuid` + `body` + `session_frame.stream_seq`
 *   automatically so the caller doesn't have to destructure.
 * - `getDedupStats()` exposes the counters B7 integrated spike uses
 *   to verify `binding-F04` conformance.
 *
 * When `meta.messageUuid` is absent (or the frame header lacks it),
 * the inspector **does not dedup** — this preserves backward
 * compatibility and avoids the false-positive risk of hashing bodies.
 */
export class SessionInspector {
  private events: InspectorEvent[] = [];
  private rejections: InspectorRejection[] = [];
  private readonly seenMessageUuids = new Set<string>();
  private dedupEligibleCount = 0;
  private duplicatesDroppedCount = 0;
  private missingMessageUuidCount = 0;

  constructor(
    /**
     * Optional body validator. When provided, the inspector calls it
     * with `{ kind, ...body }` and only records the event if it returns
     * `{ ok: true }`. Failures are captured in `getRejections()`.
     */
    private readonly bodyValidator?: (
      candidate: { kind: string } & Record<string, unknown>,
    ) => { ok: true } | { ok: false; reason: string },
  ) {}

  /**
   * Record a stream event. If `kind` is not one of the 9 canonical
   * kinds, the event is rejected and recorded in `getRejections()`.
   *
   * B6: when `meta.messageUuid` is supplied and the same uuid was
   * previously accepted, the event is **dropped** and recorded in
   * `getRejections()` with `reason: "duplicate-message"`. When the
   * field is absent, no dedup is performed.
   *
   * Automatically stamps the event at recording time.
   */
  onStreamEvent(
    kind: string,
    seq: number,
    body: unknown,
    meta?: InspectorEventMeta,
  ): void {
    const timestamp = new Date().toISOString();
    const messageUuid = meta?.messageUuid;

    if (!isSessionStreamEventKind(kind)) {
      this.rejections.push({
        kind,
        seq,
        timestamp,
        reason: "unknown-kind",
        body,
        messageUuid,
      });
      return;
    }

    if (this.bodyValidator) {
      const candidate =
        body !== null && typeof body === "object"
          ? { kind, ...(body as Record<string, unknown>) }
          : { kind };
      const result = this.bodyValidator(candidate);
      if (!result.ok) {
        this.rejections.push({
          kind,
          seq,
          timestamp,
          reason: "invalid-body",
          body,
          messageUuid,
        });
        return;
      }
    }

    // B6 — §4.2 dedup contract. Only honoured when the caller hands us
    // a messageUuid; without it the inspector keeps 1.1.0 semantics.
    if (messageUuid !== undefined && messageUuid.length > 0) {
      if (this.seenMessageUuids.has(messageUuid)) {
        this.duplicatesDroppedCount += 1;
        this.rejections.push({
          kind,
          seq,
          timestamp,
          reason: "duplicate-message",
          body,
          messageUuid,
        });
        return;
      }
      this.seenMessageUuids.add(messageUuid);
      this.dedupEligibleCount += 1;
    } else {
      this.missingMessageUuidCount += 1;
    }

    this.events.push({ kind, seq, timestamp, body, messageUuid });
  }

  /**
   * B6 — feed a whole NACP session frame. Convenience wrapper around
   * `onStreamEvent()` that extracts `header.message_uuid`, `body`, and
   * `session_frame.stream_seq` automatically.
   *
   * `body.kind` must be present (every `session.stream.event` body has
   * a `kind` discriminator); callers that know they have a frame in
   * hand should prefer this over `onStreamEvent()` to guarantee they
   * pass the dedup key.
   */
  onSessionFrame(frame: InspectorLikeSessionFrame): void {
    const body = frame.body;
    const kind =
      body !== null && typeof body === "object" && "kind" in (body as object)
        ? String((body as { kind: unknown }).kind)
        : "";
    const seq = frame.session_frame?.stream_seq ?? 0;
    const messageUuid = frame.header?.message_uuid;
    this.onStreamEvent(
      kind,
      seq,
      body,
      messageUuid !== undefined ? { messageUuid } : undefined,
    );
  }

  /** Return all recorded events in arrival order. */
  getEvents(): InspectorEvent[] {
    return [...this.events];
  }

  /**
   * Return all events matching the given kind — preserving `seq` and
   * `timestamp` so callers can debug ordering / duplicate-delivery.
   */
  filterByKind(kind: SessionStreamEventKind): InspectorEvent[] {
    return this.events.filter((e) => e.kind === kind);
  }

  /**
   * Return the most recent N events. Defaults to 10 if not specified.
   * Preserves `seq` and `timestamp` for live-debug inspection.
   */
  getLatest(n: number = 10): InspectorEvent[] {
    const start = Math.max(0, this.events.length - n);
    return this.events.slice(start);
  }

  /** Return all rejections (unknown kind, invalid body, or duplicate). */
  getRejections(): InspectorRejection[] {
    return [...this.rejections];
  }

  /**
   * B6 — counters exposed for health checks and the B7 integrated
   * spike which verifies `binding-F04` dedup conformance.
   */
  getDedupStats(): InspectorDedupStats {
    return {
      dedupEligible: this.dedupEligibleCount,
      duplicatesDropped: this.duplicatesDroppedCount,
      missingMessageUuid: this.missingMessageUuidCount,
    };
  }
}
