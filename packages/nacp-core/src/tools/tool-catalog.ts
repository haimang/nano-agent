/**
 * HP8 P4-01 — tool catalog single source of truth.
 *
 * Frozen contract:
 *   * docs/charter/plan-hero-to-pro.md §7.9 HP8
 *   * docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md §7 F4
 *   * docs/design/hero-to-pro/HPX-qna.md Q26
 *
 * The catalog enumerates every tool that the platform exposes to a
 * runtime, alongside its capability owner (which worker fulfils the
 * request), the service-binding key callers must use, and a stable
 * description. tool schema (`tool.call.request/response/cancel`) is
 * already canonical in `packages/nacp-core/src/messages/tool.ts`; this
 * file is the *registry* that pulls owner / binding / description into
 * one structure so:
 *
 *   - drift guard `scripts/check-tool-drift.mjs` can detect duplicate
 *     literal definitions outside this catalog;
 *   - future doc generators / SDK builds derive from a single shape;
 *   - capability owners are not silently re-bound across workers.
 *
 * HP8 first wave keeps the catalog small (the public tool surface
 * exposed today is `bash`); subsequent phases add filesystem /
 * workspace tools by extending this same file. Q26 forbids spawning a
 * second registry inside `agent-core` or `bash-core`.
 */

export type ToolCapabilityOwner =
  | "bash-core"
  | "filesystem-core"
  | "workspace-runtime";

export interface ToolCatalogEntry {
  /** Stable tool id used on the wire (matches `tool.call.request.tool_name`). */
  readonly tool_id: string;
  /** Worker owner that fulfils the capability call. */
  readonly capability_owner: ToolCapabilityOwner;
  /** Cloudflare service-binding key the caller must use. */
  readonly binding_key: string;
  /** Short human-readable description. */
  readonly description: string;
  /** Reserved for future doc/SDK generation; HP8 first wave is aware-only. */
  readonly stable_id: string;
}

/**
 * The frozen registry. Adding an entry MUST be paired with the
 * corresponding `tool.call.*` schema and a service binding declaration
 * in the consuming worker's wrangler config — that contract is
 * verified by `scripts/check-tool-drift.mjs`.
 */
export const TOOL_CATALOG: ReadonlyArray<ToolCatalogEntry> = Object.freeze([
  {
    tool_id: "bash",
    capability_owner: "bash-core",
    binding_key: "BASH_CORE",
    description:
      "Run a governed fake-bash capability over the bash-core service binding (NOT a real POSIX shell).",
    stable_id: "tool.bash.v1",
  },
]);

/**
 * Lookup helper. Returns null when the tool id is unknown — caller
 * decides whether to reject the request or fall back to a generic
 * hook-only handler. Drift guard treats every literal tool id outside
 * this map as suspicious.
 */
export function findToolEntry(
  toolId: string,
): ToolCatalogEntry | null {
  for (const entry of TOOL_CATALOG) {
    if (entry.tool_id === toolId) return entry;
  }
  return null;
}

/** Frozen list of allowed tool ids — used by guards and consumers. */
export const TOOL_CATALOG_IDS: ReadonlyArray<string> = Object.freeze(
  TOOL_CATALOG.map((e) => e.tool_id),
);
