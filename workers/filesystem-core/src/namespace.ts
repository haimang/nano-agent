/**
 * Workspace Context Artifacts — Workspace Namespace
 *
 * Unified namespace that wraps MountRouter and provides file operations.
 * Each operation routes through MountRouter, checks access permissions
 * (readonly mounts reject writes), then delegates to the backend.
 */

import type { WorkspacePath } from "./paths.js";
import type { WorkspaceFileEntry } from "./types.js";
import type { MountRouter } from "./mounts.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — WorkspaceNamespace
// ═══════════════════════════════════════════════════════════════════

export class WorkspaceNamespace {
  constructor(private router: MountRouter) {}

  /**
   * Expose the mount configs currently served by this namespace.
   * Used by `WorkspaceSnapshotBuilder.buildFragment()` to capture
   * `mountConfigs` into the snapshot fragment.
   */
  listMounts(): import("./types.js").MountConfig[] {
    return this.router.listMounts();
  }

  /**
   * Read a file from the workspace.
   * Returns null if the file does not exist or no mount matches.
   */
  async readFile(path: WorkspacePath): Promise<string | null> {
    const route = this.router.routePath(path);
    if (!route) {
      return null;
    }
    return route.mount.backend.read(route.relativePath);
  }

  /**
   * Write a file to the workspace.
   * Throws if the resolved mount is readonly.
   */
  async writeFile(path: WorkspacePath, content: string): Promise<void> {
    const route = this.router.routePath(path);
    if (!route) {
      throw new Error(`No mount found for path: ${String(path)}`);
    }
    if (route.mount.config.access === "readonly") {
      throw new Error(
        `Cannot write to readonly mount at ${route.mount.config.mountPoint}`,
      );
    }
    return route.mount.backend.write(route.relativePath, content);
  }

  /**
   * List directory contents at the given path.
   * Returns an empty array if no mount matches.
   */
  async listDir(path: WorkspacePath): Promise<WorkspaceFileEntry[]> {
    const route = this.router.routePath(path);
    if (!route) {
      return [];
    }

    const entries = await route.mount.backend.list(route.relativePath);
    const mountPrefix =
      route.mount.config.mountPoint === "/"
        ? "/"
        : route.mount.config.mountPoint + "/";
    const dirPath = route.relativePath === "" ? "" : route.relativePath + "/";

    return entries.map((entry) => ({
      path: mountPrefix === "/" ? `/${dirPath}${entry.name}` : `${mountPrefix}${dirPath}${entry.name}`,
      size: entry.size,
      modifiedAt: new Date().toISOString(),
    }));
  }

  /**
   * Get file metadata.
   * Returns null if the file does not exist or no mount matches.
   */
  async stat(path: WorkspacePath): Promise<WorkspaceFileEntry | null> {
    const route = this.router.routePath(path);
    if (!route) {
      return null;
    }

    const statResult = await route.mount.backend.stat(route.relativePath);
    if (!statResult) {
      return null;
    }

    return {
      path: String(path),
      size: statResult.size,
      modifiedAt: statResult.modifiedAt,
    };
  }

  /**
   * Delete a file from the workspace.
   * Throws if the resolved mount is readonly.
   * Returns false if no mount matches.
   */
  async deleteFile(path: WorkspacePath): Promise<boolean> {
    const route = this.router.routePath(path);
    if (!route) {
      return false;
    }
    if (route.mount.config.access === "readonly") {
      throw new Error(
        `Cannot delete from readonly mount at ${route.mount.config.mountPoint}`,
      );
    }
    return route.mount.backend.delete(route.relativePath);
  }
}
