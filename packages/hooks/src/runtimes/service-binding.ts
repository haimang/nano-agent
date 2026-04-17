/**
 * @nano-agent/hooks — service binding runtime stub.
 *
 * Placeholder for remote hook worker execution via service bindings.
 * The actual transport wiring will happen in session-do-runtime.
 */

import type { HookHandlerConfig } from "../types.js";
import type { HookOutcome } from "../outcome.js";
import type { HookRuntime } from "./local-ts.js";

/**
 * Service binding runtime for remote hook workers.
 * Currently a stub — throws on every call until the session-do-runtime
 * transport layer is wired.
 */
export class ServiceBindingRuntime implements HookRuntime {
  async execute(
    _handler: HookHandlerConfig,
    _payload: unknown,
    _context: unknown,
  ): Promise<HookOutcome> {
    throw new Error("service-binding runtime not yet connected");
  }
}
