/**
 * Workspace Context Artifacts — Path Utilities
 *
 * Provides a branded WorkspacePath type and utility functions
 * for normalizing and comparing workspace-scoped paths.
 */

// ═══════════════════════════════════════════════════════════════════
// §1 — Branded WorkspacePath
// ═══════════════════════════════════════════════════════════════════

declare const __workspacePath: unique symbol;

/**
 * A branded string type representing a normalized, validated workspace path.
 * Always starts with "/" and never contains ".." traversals.
 */
export type WorkspacePath = string & { readonly [__workspacePath]: true };

// ═══════════════════════════════════════════════════════════════════
// §2 — Root Constant
// ═══════════════════════════════════════════════════════════════════

export const WORKSPACE_ROOT: WorkspacePath = "/" as WorkspacePath;

// ═══════════════════════════════════════════════════════════════════
// §3 — normalizePath
// ═══════════════════════════════════════════════════════════════════

/**
 * Normalize a raw path string into a validated WorkspacePath.
 *
 * - Collapses multiple slashes
 * - Resolves `.` and `..` segments
 * - Ensures the result starts with `/`
 * - Strips trailing slashes (except for root `/`)
 * - Rejects paths that escape above root
 */
export function normalizePath(raw: string): WorkspacePath {
  if (raw === "" || raw === "/") {
    return WORKSPACE_ROOT;
  }

  const segments = raw.split("/").filter((s) => s !== "" && s !== ".");
  const resolved: string[] = [];

  for (const seg of segments) {
    if (seg === "..") {
      if (resolved.length === 0) {
        throw new Error(`Path escapes workspace root: ${raw}`);
      }
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }

  const result = "/" + resolved.join("/");
  return result as WorkspacePath;
}

// ═══════════════════════════════════════════════════════════════════
// §4 — isChildOf
// ═══════════════════════════════════════════════════════════════════

/**
 * Returns true if `child` is a descendant of (or equal to) `parent`.
 */
export function isChildOf(parent: WorkspacePath, child: WorkspacePath): boolean {
  if (parent === WORKSPACE_ROOT) {
    return true;
  }
  return child === parent || child.startsWith(parent + "/");
}
