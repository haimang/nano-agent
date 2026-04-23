/**
 * Workspace Context Artifacts — Mount Router
 *
 * Routes workspace paths to the correct backend using longest-prefix
 * matching, inspired by just-bash's MountableFs.routePath().
 *
 * Mount points are normalized workspace paths. When multiple mounts
 * match a path, the mount with the longest prefix wins, ensuring
 * that more specific mounts override broader ones.
 */

import type { MountConfig } from "./types.js";
import type { WorkspacePath } from "./paths.js";
import type { WorkspaceBackend } from "./backends/types.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Mount
// ═══════════════════════════════════════════════════════════════════

export interface Mount {
  config: MountConfig;
  backend: WorkspaceBackend;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — Route Result
// ═══════════════════════════════════════════════════════════════════

export interface RouteResult {
  mount: Mount;
  relativePath: string;
}

// ═══════════════════════════════════════════════════════════════════
// §3 — MountRouter
// ═══════════════════════════════════════════════════════════════════

export class MountRouter {
  private mounts: Map<string, Mount> = new Map();

  /**
   * Register a mount at the given config's mountPoint.
   * If a mount already exists at that path, it is replaced.
   */
  addMount(config: MountConfig, backend: WorkspaceBackend): void {
    const key = this.normalizeMountPoint(config.mountPoint);
    this.mounts.set(key, { config: { ...config, mountPoint: key }, backend });
  }

  /**
   * Remove a mount by its mount point path.
   */
  removeMount(mountPoint: string): void {
    const key = this.normalizeMountPoint(mountPoint);
    this.mounts.delete(key);
  }

  /**
   * Route a workspace path to its matching mount using longest-prefix matching.
   *
   * For path `/workspace/src/index.ts`, if mounts exist at `/` and `/workspace`,
   * this returns the `/workspace` mount with relativePath `src/index.ts`.
   *
   * `_platform/` is a RESERVED namespace in v1 — paths under
   * `/_platform/` (or `/_platform`) are never routed through a
   * catch-all tenant mount, even if a root mount (`/`) is registered.
   * A platform handler can still claim the namespace by registering a
   * mount at `/_platform` (or deeper `_platform/...`); only the root
   * catch-all cannot swallow `_platform/` accidentally.
   *
   * Returns null if no mount matches the path.
   */
  routePath(path: WorkspacePath): RouteResult | null {
    const normalizedPath = String(path);

    if (this.isReservedPlatformPath(normalizedPath)) {
      // Explicit `_platform/...` mounts take precedence; a bare root
      // (`/`) mount MUST NOT swallow the reserved namespace.
      return this.findLongestMatchFiltered(normalizedPath, (mp) =>
        mp === "/_platform" || mp.startsWith("/_platform/"),
      );
    }

    return this.findLongestMatchFiltered(normalizedPath, () => true);
  }

  /**
   * List all currently registered mount configurations.
   */
  listMounts(): MountConfig[] {
    return Array.from(this.mounts.values()).map((m) => m.config);
  }

  // ── Private helpers ──

  private normalizeMountPoint(raw: string): string {
    // Ensure mount points start with / and have no trailing slash (except root)
    let normalized = raw.replace(/\/+/g, "/");
    if (!normalized.startsWith("/")) {
      normalized = "/" + normalized;
    }
    if (normalized !== "/" && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }

  private pathMatchesMount(path: string, mountPoint: string): boolean {
    if (mountPoint === "/") {
      return true;
    }
    return path === mountPoint || path.startsWith(mountPoint + "/");
  }

  private isReservedPlatformPath(normalizedPath: string): boolean {
    return normalizedPath === "/_platform" || normalizedPath.startsWith("/_platform/");
  }

  /**
   * Longest-prefix match across all mounts that satisfy the filter.
   * Returns null if no candidate mount matches.
   */
  private findLongestMatchFiltered(
    normalizedPath: string,
    accept: (mountPoint: string) => boolean,
  ): RouteResult | null {
    let bestMatch: string | null = null;
    let bestLength = -1;

    for (const mountPoint of this.mounts.keys()) {
      if (!accept(mountPoint)) continue;
      if (this.pathMatchesMount(normalizedPath, mountPoint)) {
        if (mountPoint.length > bestLength) {
          bestMatch = mountPoint;
          bestLength = mountPoint.length;
        }
      }
    }
    if (bestMatch === null) return null;
    const mount = this.mounts.get(bestMatch)!;
    const relativePath = this.computeRelativePath(normalizedPath, bestMatch);
    return { mount, relativePath };
  }

  private computeRelativePath(path: string, mountPoint: string): string {
    if (mountPoint === "/") {
      // Strip leading slash for root mount
      return path === "/" ? "" : path.slice(1);
    }

    if (path === mountPoint) {
      return "";
    }

    // Strip mount prefix and the separating slash
    return path.slice(mountPoint.length + 1);
  }
}
