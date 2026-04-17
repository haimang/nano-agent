/**
 * Exec Capability Handler
 *
 * Controlled TypeScript execution. Currently evaluates code in a
 * limited scope. In a real deployment, this would use an isolated VM
 * or sandboxed runtime.
 */

import type { LocalCapabilityHandler } from "../targets/local-ts.js";

interface ExecInput {
  code?: string;
}

/**
 * Create the exec capability handler.
 *
 * Returns a Map with a "ts-exec" handler.
 */
export function createExecHandlers(): Map<string, LocalCapabilityHandler> {
  const handlers = new Map<string, LocalCapabilityHandler>();

  handlers.set("ts-exec", async (input) => {
    const { code = "" } = (input ?? {}) as ExecInput;

    if (!code) {
      throw new Error("ts-exec: no code provided");
    }

    // In a real implementation, this would run in a sandbox.
    // For now, we just acknowledge the code and return a stub.
    return {
      output: `[ts-exec] executed ${code.length} characters of code (stub: sandboxed execution not yet connected)`,
    };
  });

  return handlers;
}
