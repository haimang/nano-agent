/**
 * @nano-agent/hooks — central hook registry with source-layered priority.
 *
 * Handlers are stored in registration order and returned sorted by source
 * priority at lookup time: platform-policy > session > skill.
 */

import type { HookHandlerConfig, HookSource } from "./types.js";
import type { HookEventName } from "./catalog.js";

/** Numeric priority for each source — lower number = higher priority. */
const SOURCE_PRIORITY: Record<HookSource, number> = {
  "platform-policy": 0,
  session: 1,
  skill: 2,
};

export class HookRegistry {
  private handlers: Map<string, HookHandlerConfig> = new Map();
  /** Insertion counter so we can break ties within the same source. */
  private insertionOrder: Map<string, number> = new Map();
  private counter = 0;

  /** Register a handler. Replaces any existing handler with the same id. */
  register(handler: HookHandlerConfig): void {
    this.handlers.set(handler.id, handler);
    this.insertionOrder.set(handler.id, this.counter++);
  }

  /** Remove a handler by id. No-op if not found. */
  unregister(handlerId: string): void {
    this.handlers.delete(handlerId);
    this.insertionOrder.delete(handlerId);
  }

  /**
   * Look up all handlers registered for the given event name, returned
   * sorted by source priority (platform-policy > session > skill).
   * Within the same source, handlers are ordered by registration time.
   */
  lookup(eventName: HookEventName): HookHandlerConfig[] {
    const matches: HookHandlerConfig[] = [];
    for (const handler of this.handlers.values()) {
      if (handler.event === eventName) {
        matches.push(handler);
      }
    }
    return matches.sort((a, b) => {
      const pA = SOURCE_PRIORITY[a.source];
      const pB = SOURCE_PRIORITY[b.source];
      if (pA !== pB) return pA - pB;
      return (this.insertionOrder.get(a.id) ?? 0) - (this.insertionOrder.get(b.id) ?? 0);
    });
  }

  /** Return every registered handler (no particular order guaranteed). */
  listAll(): HookHandlerConfig[] {
    return Array.from(this.handlers.values());
  }

  /** Return all handlers originating from the given source. */
  listBySource(source: HookSource): HookHandlerConfig[] {
    return Array.from(this.handlers.values()).filter((h) => h.source === source);
  }

  /** Remove all handlers. */
  clear(): void {
    this.handlers.clear();
    this.insertionOrder.clear();
    this.counter = 0;
  }
}
