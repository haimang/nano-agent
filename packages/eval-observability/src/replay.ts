/**
 * @nano-agent/eval-observability — Failure replay helper.
 *
 * Provides utilities for extracting failure-related events from a
 * SessionTimeline, building failure summaries, and retrieving
 * context events leading up to errors.
 */

import type { TraceEvent } from "./trace-event.js";
import type { SessionTimeline } from "./timeline.js";

/**
 * Helper class for analyzing and replaying failure events from a session timeline.
 *
 * Constructed from a SessionTimeline, it extracts error events and provides
 * summary and context methods useful for debugging and eval reporting.
 */
export class FailureReplayHelper {
  private readonly allEvents: TraceEvent[];

  private constructor(events: TraceEvent[]) {
    this.allEvents = events;
  }

  /** Construct a FailureReplayHelper from a SessionTimeline. */
  static fromTimeline(timeline: SessionTimeline): FailureReplayHelper {
    return new FailureReplayHelper(timeline.getEvents());
  }

  /**
   * Return all events that carry an error field.
   * Events are returned in timeline order (ascending timestamp).
   */
  getFailureEvents(): TraceEvent[] {
    return this.allEvents.filter((e) => e.error !== undefined);
  }

  /**
   * Build a concise summary of failures in the timeline.
   *
   * Returns error count, first/last error events, and a deduplicated
   * list of error event kinds.
   */
  buildFailureSummary(): {
    errorCount: number;
    firstError: TraceEvent | null;
    lastError: TraceEvent | null;
    errorKinds: string[];
  } {
    const failures = this.getFailureEvents();

    if (failures.length === 0) {
      return {
        errorCount: 0,
        firstError: null,
        lastError: null,
        errorKinds: [],
      };
    }

    const kindSet = new Set<string>();
    for (const f of failures) {
      kindSet.add(f.eventKind);
    }

    return {
      errorCount: failures.length,
      firstError: failures[0],
      lastError: failures[failures.length - 1],
      errorKinds: [...kindSet],
    };
  }

  /**
   * Return up to `count` events that occurred before the given timestamp.
   * Useful for retrieving context leading up to a failure.
   *
   * @param timestamp - ISO 8601 timestamp upper bound (exclusive)
   * @param count - Maximum number of events to return (default 10)
   */
  getEventsBefore(timestamp: string, count: number = 10): TraceEvent[] {
    const before = this.allEvents.filter(
      (e) => e.timestamp < timestamp,
    );
    const start = Math.max(0, before.length - count);
    return before.slice(start);
  }
}
