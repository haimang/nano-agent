/**
 * @nano-agent/eval-observability — session timeline builder.
 *
 * Reads durable trace events and provides sorted, filterable access.
 * Works with any source that exposes a `readTimeline()` method, which
 * includes `DoStorageTraceSink` but also any HTTP-fallback reader that
 * fetches durable events over a backend API.
 */

import type { TraceEvent } from "./trace-event.js";

/**
 * Minimal interface for anything that can yield a session's durable
 * trace events. Both `DoStorageTraceSink` and HTTP-fallback readers
 * implement this seam.
 */
export interface TraceTimelineReader {
  readTimeline(): Promise<TraceEvent[]>;
}

/**
 * An in-memory, sorted collection of trace events for a single session.
 */
export class SessionTimeline {
  private events: TraceEvent[] = [];

  /**
   * Construct a SessionTimeline from any TraceTimelineReader.
   *
   * This is the generic construction path used for both live-sink reads
   * (e.g. `DoStorageTraceSink.readTimeline()`) and HTTP-fallback reads.
   */
  static async fromSink(reader: TraceTimelineReader): Promise<SessionTimeline> {
    const timeline = new SessionTimeline();
    const events = await reader.readTimeline();
    for (const event of events) {
      timeline.events.push(event);
    }
    return timeline;
  }

  /** Add a single event to the timeline. */
  addEvent(event: TraceEvent): void {
    this.events.push(event);
    // Maintain sorted order by timestamp.
    this.events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /** Return all events, sorted by timestamp (ascending). */
  getEvents(): TraceEvent[] {
    return [...this.events];
  }

  /** Return only events matching the given event kind. */
  filterByKind(eventKind: string): TraceEvent[] {
    return this.events.filter((e) => e.eventKind === eventKind);
  }

  /** Return only events belonging to a specific turn. */
  filterByTurn(turnUuid: string): TraceEvent[] {
    return this.events.filter((e) => e.turnUuid === turnUuid);
  }

  /**
   * Return the time range spanned by events in this timeline.
   * Returns `null` if the timeline is empty.
   */
  getTimeRange(): { first: string; last: string } | null {
    if (this.events.length === 0) {
      return null;
    }
    return {
      first: this.events[0].timestamp,
      last: this.events[this.events.length - 1].timestamp,
    };
  }

  /** Return the number of events in this timeline. */
  size(): number {
    return this.events.length;
  }
}
