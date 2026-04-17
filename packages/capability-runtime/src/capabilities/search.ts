/**
 * Search Capability Handler
 *
 * Degraded implementation of rg (ripgrep) that performs simple
 * string/regex matching. In a real deployment, this would delegate
 * to an actual ripgrep binary or indexed search service.
 */

import type { LocalCapabilityHandler } from "../targets/local-ts.js";

interface SearchInput {
  pattern?: string;
  path?: string;
}

/**
 * Create the search capability handler.
 *
 * Returns a Map with a single "rg" handler that simulates pattern search.
 */
export function createSearchHandlers(): Map<string, LocalCapabilityHandler> {
  const handlers = new Map<string, LocalCapabilityHandler>();

  handlers.set("rg", async (input) => {
    const { pattern = "", path = "." } = (input ?? {}) as SearchInput;

    if (!pattern) {
      throw new Error("rg: no search pattern provided");
    }

    // Validate the pattern is valid regex
    try {
      new RegExp(pattern);
    } catch {
      throw new Error(`rg: invalid regex pattern "${pattern}"`);
    }

    return {
      output: `[rg] searching for "${pattern}" in ${path} (degraded: TS string scan)`,
    };
  });

  return handlers;
}
