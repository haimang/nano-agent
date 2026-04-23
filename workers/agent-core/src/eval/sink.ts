/**
 * @nano-agent/eval-observability — TraceSink interface.
 *
 * The single abstraction for durable trace persistence. Session DOs call
 * `traceSink.emit(event)` without caring where events ultimately land.
 * Implementations can write to DO storage, an external service, or /dev/null.
 */

import type { TraceEvent } from "./trace-event.js";

/** A sink that accepts trace events for persistence or forwarding. */
export interface TraceSink {
  /** Persist or forward a single trace event. */
  emit(event: TraceEvent): Promise<void>;

  /** Flush any buffered events, ensuring they are durably written. */
  flush(): Promise<void>;
}
