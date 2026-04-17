/**
 * Network Capability Handler
 *
 * Controlled fetch/curl implementation. Currently returns a stub response.
 * In a real deployment, this would use a sandboxed fetch with allow-lists.
 */

import type { LocalCapabilityHandler } from "../targets/local-ts.js";

interface CurlInput {
  url?: string;
}

/**
 * Create the network capability handler.
 *
 * Returns a Map with a "curl" handler.
 */
export function createNetworkHandlers(): Map<string, LocalCapabilityHandler> {
  const handlers = new Map<string, LocalCapabilityHandler>();

  handlers.set("curl", async (input) => {
    const { url = "" } = (input ?? {}) as CurlInput;

    if (!url) {
      throw new Error("curl: no URL provided");
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      throw new Error(`curl: invalid URL "${url}"`);
    }

    return {
      output: `[curl] fetching: ${url} (stub: network access not yet connected)`,
    };
  });

  return handlers;
}
