/**
 * Filesystem Capability Handlers
 *
 * Minimal in-process implementations of filesystem operations.
 * These operate on a virtual workspace namespace (a base directory path).
 *
 * In a real deployment, these would be replaced by sandboxed implementations.
 * Here they serve as the reference implementation for testing.
 */

import type { LocalCapabilityHandler } from "../targets/local-ts.js";

/** Input shapes for filesystem commands. */
interface PathInput {
  path?: string;
}

interface WriteInput {
  path?: string;
  content?: string;
}

interface TwoPathInput {
  source?: string;
  destination?: string;
}

interface FilesystemHandlersConfig {
  workspacePath?: string;
  namespace?: {
    readFile(path: unknown): Promise<string | null>;
    writeFile(path: unknown, content: string): Promise<void>;
    listDir(path: unknown): Promise<Array<{ path: string; size: number }>>;
    deleteFile(path: unknown): Promise<boolean>;
  };
}

/**
 * Create filesystem capability handlers scoped to a workspace.
 *
 * @param namespace Configuration for the workspace. Currently accepts
 *   `{ workspacePath: string }` to set the root directory.
 */
export function createFilesystemHandlers(
  namespace: unknown,
): Map<string, LocalCapabilityHandler> {
  const config = isFilesystemHandlersConfig(namespace) ? namespace : undefined;
  const base = config?.workspacePath ?? "/workspace";
  const workspace = config?.namespace;

  const handlers = new Map<string, LocalCapabilityHandler>();

  handlers.set("pwd", async (_input) => {
    return { output: base };
  });

  handlers.set("ls", async (input) => {
    const { path = "." } = (input ?? {}) as PathInput;
    const resolved = resolvePath(base, path);
    if (workspace) {
      const entries = await workspace.listDir(resolved);
      return {
        output: entries
          .map((entry) => entry.path)
          .sort((a, b) => a.localeCompare(b))
          .join("\n"),
      };
    }
    // Simulated listing
    return {
      output: `[ls] listing: ${resolved}`,
    };
  });

  handlers.set("cat", async (input) => {
    const { path = "" } = (input ?? {}) as PathInput;
    if (!path) {
      throw new Error("cat: no file path provided");
    }
    const resolved = resolvePath(base, path);
    if (workspace) {
      const content = await workspace.readFile(resolved);
      if (content === null) {
        throw new Error(`cat: ${resolved}: No such file`);
      }
      return {
        output: content,
      };
    }
    return {
      output: `[cat] reading: ${resolved}`,
    };
  });

  handlers.set("write", async (input) => {
    const { path = "", content = "" } = (input ?? {}) as WriteInput;
    if (!path) {
      throw new Error("write: no file path provided");
    }
    const resolved = resolvePath(base, path);
    if (workspace) {
      await workspace.writeFile(resolved, content);
    }
    return {
      output: `[write] wrote ${content.length} bytes to ${resolved}`,
    };
  });

  handlers.set("mkdir", async (input) => {
    const { path = "" } = (input ?? {}) as PathInput;
    if (!path) {
      throw new Error("mkdir: no directory path provided");
    }
    const resolved = resolvePath(base, path);
    return {
      output: `[mkdir] created: ${resolved}`,
    };
  });

  handlers.set("rm", async (input) => {
    const { path = "" } = (input ?? {}) as PathInput;
    if (!path) {
      throw new Error("rm: no path provided");
    }
    const resolved = resolvePath(base, path);
    if (workspace) {
      const deleted = await workspace.deleteFile(resolved);
      if (!deleted) {
        throw new Error(`rm: ${resolved}: No such file`);
      }
    }
    return {
      output: `[rm] removed: ${resolved}`,
    };
  });

  handlers.set("mv", async (input) => {
    const { source = "", destination = "" } = (input ?? {}) as TwoPathInput;
    if (!source || !destination) {
      throw new Error("mv: source and destination required");
    }
    const resolvedSrc = resolvePath(base, source);
    const resolvedDst = resolvePath(base, destination);
    if (workspace) {
      const content = await workspace.readFile(resolvedSrc);
      if (content === null) {
        throw new Error(`mv: ${resolvedSrc}: No such file`);
      }
      await workspace.writeFile(resolvedDst, content);
      await workspace.deleteFile(resolvedSrc);
    }
    return {
      output: `[mv] moved: ${resolvedSrc} -> ${resolvedDst}`,
    };
  });

  handlers.set("cp", async (input) => {
    const { source = "", destination = "" } = (input ?? {}) as TwoPathInput;
    if (!source || !destination) {
      throw new Error("cp: source and destination required");
    }
    const resolvedSrc = resolvePath(base, source);
    const resolvedDst = resolvePath(base, destination);
    if (workspace) {
      const content = await workspace.readFile(resolvedSrc);
      if (content === null) {
        throw new Error(`cp: ${resolvedSrc}: No such file`);
      }
      await workspace.writeFile(resolvedDst, content);
    }
    return {
      output: `[cp] copied: ${resolvedSrc} -> ${resolvedDst}`,
    };
  });

  return handlers;
}

/** Resolve a path relative to the base workspace path. */
function resolvePath(base: string, path: string): string {
  const raw = path.startsWith("/") ? path : `${stripTrailingSlash(base)}/${path}`;
  const segments = raw.split("/").filter((segment) => segment !== "" && segment !== ".");
  const resolved: string[] = [];

  for (const segment of segments) {
    if (segment === "..") {
      if (resolved.length === 0) {
        throw new Error(`Path escapes workspace root: ${path}`);
      }
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  return "/" + resolved.join("/");
}

function stripTrailingSlash(path: string): string {
  return path === "/" ? "/" : path.replace(/\/+$/, "");
}

function isFilesystemHandlersConfig(value: unknown): value is FilesystemHandlersConfig {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (
    "workspacePath" in candidate &&
    candidate.workspacePath !== undefined &&
    typeof candidate.workspacePath !== "string"
  ) {
    return false;
  }

  if (!("namespace" in candidate) || candidate.namespace === undefined) {
    return true;
  }

  if (!candidate.namespace || typeof candidate.namespace !== "object") {
    return false;
  }

  const namespace = candidate.namespace as Record<string, unknown>;
  return (
    typeof namespace.readFile === "function" &&
    typeof namespace.writeFile === "function" &&
    typeof namespace.listDir === "function" &&
    typeof namespace.deleteFile === "function"
  );
}
