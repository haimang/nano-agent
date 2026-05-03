/**
 * @nano-agent/hooks — local TypeScript runtime for trusted in-process handlers.
 *
 * Handlers are plain async functions registered by id. The runtime looks up
 * the function by handler config id and invokes it directly.
 */

import type { HookHandlerConfig } from "../types.js";
import type { HookOutcome } from "../outcome.js";

/** Signature for a locally-registered hook handler function. */
export type LocalHookHandler = (
  payload: unknown,
  context: unknown,
) => Promise<HookOutcome>;

/** Interface that all hook runtimes must implement. */
export interface HookRuntime {
  execute(
    handler: HookHandlerConfig,
    payload: unknown,
    context: unknown,
  ): Promise<HookOutcome>;
}

/**
 * Runtime that executes local TypeScript functions registered in-process.
 */
export class LocalTsRuntime implements HookRuntime {
  private handlers: Map<string, LocalHookHandler> = new Map();

  /** Register a handler function under the given id. */
  registerHandler(handlerId: string, fn: LocalHookHandler): void {
    this.handlers.set(handlerId, fn);
  }

  /** Remove a handler function by id. */
  unregisterHandler(handlerId: string): void {
    this.handlers.delete(handlerId);
  }

  /** Execute the handler identified by `handler.id`. */
  async execute(
    handler: HookHandlerConfig,
    payload: unknown,
    context: unknown,
  ): Promise<HookOutcome> {
    const fn = this.handlers.get(handler.id);
    if (!fn) {
      throw new Error(
        `LocalTsRuntime: no handler function registered for id "${handler.id}"`,
      );
    }
    return fn(payload, context);
  }
}
