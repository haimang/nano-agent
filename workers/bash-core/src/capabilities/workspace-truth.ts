/**
 * Workspace truth + path law (A8 Phase 1).
 *
 * The single source of truth for fake-bash file/search ops is the
 * `WorkspaceNamespace + MountRouter` pair owned by
 * `@nano-agent/workspace-context-artifacts`. This module codifies the
 * **path law** every filesystem and search handler MUST consume so the
 * three surfaces — `ls / cat / rg` — give consistent answers for the
 * same input string.
 *
 * Path law (frozen v1):
 *   1. **Workspace root.** The default workspace root is `/workspace`.
 *      Callers may override at construction time but every command in a
 *      single session shares the same root.
 *   2. **Reserved namespace.** `/_platform/**` is NEVER bash-visible.
 *      Both filesystem and search MUST refuse to operate on paths that
 *      normalise into this namespace, with a typed `reserved-namespace`
 *      error code.
 *   3. **Normalisation.** `.` and empty segments are dropped; `..`
 *      pops one segment but cannot escape the workspace root. Bare
 *      `.` becomes the workspace root itself.
 *   4. **Absolute vs relative.** A leading `/` is honoured (interpreted
 *      against the workspace root, NOT the OS root). A leading `./` or
 *      `path/like/this` is resolved against the workspace root.
 *   5. **Trailing slash.** Trimmed for the canonical form. `/` is the
 *      workspace root itself.
 *
 * The path law is consumed by both `createFilesystemHandlers()` and
 * `createSearchHandlers()` so divergence is caught at the type level.
 */

/** Default workspace root — `/workspace`. */
export const DEFAULT_WORKSPACE_ROOT = "/workspace";

/** The reserved-namespace prefix (server-only zone). */
export const RESERVED_NAMESPACE_PREFIX = "/_platform";

/** Discriminated error returned when a caller asks for a forbidden path. */
export type WorkspacePathError =
  | { readonly reason: "reserved-namespace"; readonly path: string }
  | { readonly reason: "escapes-workspace-root"; readonly path: string };

export interface WorkspacePathResult {
  /** True when the path was accepted; consult `path` then. */
  readonly ok: boolean;
  readonly path: string;
  readonly error?: WorkspacePathError;
}

/** Strip trailing `/` (except the lone root). */
function stripTrailingSlash(path: string): string {
  return path === "/" ? "/" : path.replace(/\/+$/, "");
}

/**
 * Resolve a caller-supplied path against the workspace root following
 * the v1 path law. Returns a discriminated result so callers don't
 * need to throw / catch — they pattern-match on `ok` instead.
 */
export function resolveWorkspacePath(
  base: string,
  raw: string,
): WorkspacePathResult {
  const root = stripTrailingSlash(base) || "/";
  const candidate = raw && raw.length > 0 ? raw : ".";
  const wasRelative = !candidate.startsWith("/");
  const absolute = wasRelative ? `${root}/${candidate}` : candidate;
  const rootSegments = root === "/" ? [] : root.split("/").filter(Boolean);

  const segments: string[] = [];
  for (const segment of absolute.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        return {
          ok: false,
          path: raw,
          error: { reason: "escapes-workspace-root", path: raw },
        };
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  // For relative paths the result MUST stay inside the configured
  // workspace root. `..` that walks up past the root is an escape;
  // absolute paths are intentional addressing under the workspace's
  // logical `/` (fake-bash has no OS root).
  if (wasRelative && rootSegments.length > 0) {
    const insideRoot =
      segments.length >= rootSegments.length &&
      rootSegments.every((seg, i) => segments[i] === seg);
    if (!insideRoot) {
      return {
        ok: false,
        path: raw,
        error: { reason: "escapes-workspace-root", path: raw },
      };
    }
  }

  const normalized = "/" + segments.join("/");

  if (
    normalized === RESERVED_NAMESPACE_PREFIX ||
    normalized.startsWith(`${RESERVED_NAMESPACE_PREFIX}/`)
  ) {
    return {
      ok: false,
      path: normalized,
      error: { reason: "reserved-namespace", path: normalized },
    };
  }

  return {
    ok: true,
    path: normalized === "/" ? "/" : stripTrailingSlash(normalized),
  };
}

/** Throw-shaped wrapper for callers that prefer exceptions. */
export function resolveWorkspacePathOrThrow(base: string, raw: string): string {
  const result = resolveWorkspacePath(base, raw);
  if (result.ok) return result.path;
  if (result.error?.reason === "reserved-namespace") {
    throw new Error(
      `path '${result.error.path}' is in the reserved /_platform namespace`,
    );
  }
  throw new Error(`Path escapes workspace root: ${raw}`);
}

/**
 * Convenience predicate the search handler uses when iterating over
 * candidate paths returned by the namespace listing.
 */
export function isReservedNamespacePath(path: string): boolean {
  return (
    path === RESERVED_NAMESPACE_PREFIX ||
    path.startsWith(`${RESERVED_NAMESPACE_PREFIX}/`)
  );
}

/**
 * The minimum WorkspaceNamespace surface every fake-bash command
 * consumes. Mirroring the structural shape used by
 * `@nano-agent/workspace-context-artifacts::WorkspaceNamespace`
 * keeps capability-runtime free of a runtime dep on workspace.
 */
export interface WorkspaceFsLike {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<Array<{ path: string; size: number }>>;
  deleteFile(path: string): Promise<boolean>;
}
