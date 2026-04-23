/**
 * @nano-agent/hooks — registry snapshot / restore for DO hibernation.
 *
 * Serializes the hook registry state so it can be persisted across
 * Durable Object hibernation cycles, then restored on wake.
 */

import type { HookHandlerConfig } from "./types.js";
import { HookRegistry } from "./registry.js";
import { HOOKS_VERSION } from "./version.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Hook Registry Snapshot
// ═══════════════════════════════════════════════════════════════════

export interface HookRegistrySnapshot {
  readonly version: string;
  readonly handlers: HookHandlerConfig[];
  readonly snapshotAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — snapshotRegistry
// ═══════════════════════════════════════════════════════════════════

/**
 * Capture a snapshot of the current registry state.
 * Returns a serializable object containing all registered handlers.
 */
export function snapshotRegistry(registry: HookRegistry): HookRegistrySnapshot {
  return {
    version: HOOKS_VERSION,
    handlers: registry.listAll(),
    snapshotAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// §3 — restoreRegistry
// ═══════════════════════════════════════════════════════════════════

/**
 * Restore a registry from a snapshot. Creates a new HookRegistry
 * and re-registers all handlers in their original order.
 */
export function restoreRegistry(snapshot: HookRegistrySnapshot): HookRegistry {
  const registry = new HookRegistry();

  for (const handler of snapshot.handlers) {
    registry.register(handler);
  }

  return registry;
}
