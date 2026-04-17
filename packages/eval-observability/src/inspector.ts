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

/** A single event observed by the inspector. */
export interface InspectorEvent {
  readonly kind: SessionStreamEventKind;
  readonly seq: number;
  readonly timestamp: string;
  readonly body: unknown;
}

/** Diagnostic record for an event that failed validation. */
export interface InspectorRejection {
  readonly kind: string;
  readonly seq: number;
  readonly timestamp: string;
  readonly reason: "unknown-kind" | "invalid-body";
  readonly body: unknown;
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
 */
export class SessionInspector {
  private events: InspectorEvent[] = [];
  private rejections: InspectorRejection[] = [];

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
   * Record a stream event. If `kind` is not one of the 9 canonical kinds,
   * the event is rejected and recorded in `getRejections()`. Automatically
   * stamps the event at recording time.
   */
  onStreamEvent(kind: string, seq: number, body: unknown): void {
    const timestamp = new Date().toISOString();

    if (!isSessionStreamEventKind(kind)) {
      this.rejections.push({ kind, seq, timestamp, reason: "unknown-kind", body });
      return;
    }

    if (this.bodyValidator) {
      const candidate =
        body !== null && typeof body === "object"
          ? { kind, ...(body as Record<string, unknown>) }
          : { kind };
      const result = this.bodyValidator(candidate);
      if (!result.ok) {
        this.rejections.push({ kind, seq, timestamp, reason: "invalid-body", body });
        return;
      }
    }

    this.events.push({ kind, seq, timestamp, body });
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

  /** Return all rejections (unknown kind or invalid body). */
  getRejections(): InspectorRejection[] {
    return [...this.rejections];
  }
}
