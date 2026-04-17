/**
 * VCS (Version Control System) Capability Handlers
 *
 * Virtual git subset — stubs for status and diff operations.
 * These are read-only git introspection commands, safe to expose
 * without requiring real git access.
 */

import type { LocalCapabilityHandler } from "../targets/local-ts.js";

interface GitInput {
  subcommand?: string;
  args?: string[];
}

/** Supported git subcommands in the virtual VCS layer. */
const SUPPORTED_SUBCOMMANDS = new Set(["status", "diff", "log"]);

/**
 * Create VCS capability handlers.
 *
 * Returns a Map with a "git" handler that supports a limited subset
 * of git subcommands.
 */
export function createVcsHandlers(): Map<string, LocalCapabilityHandler> {
  const handlers = new Map<string, LocalCapabilityHandler>();

  handlers.set("git", async (input) => {
    const { subcommand = "", args = [] } = (input ?? {}) as GitInput;

    if (!subcommand) {
      throw new Error("git: no subcommand provided");
    }

    if (!SUPPORTED_SUBCOMMANDS.has(subcommand)) {
      throw new Error(
        `git: subcommand "${subcommand}" is not supported. ` +
          `Supported: ${Array.from(SUPPORTED_SUBCOMMANDS).join(", ")}`,
      );
    }

    const argStr = args.length > 0 ? ` ${args.join(" ")}` : "";
    return {
      output: `[git ${subcommand}${argStr}] (stub: VCS access not yet connected)`,
    };
  });

  return handlers;
}
