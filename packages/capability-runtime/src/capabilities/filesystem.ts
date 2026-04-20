/**
 * Filesystem Capability Handlers (A8 Phase 2 hardening).
 *
 * The handlers below consume the v1 path law from
 * `capabilities/workspace-truth.ts` so file ops, search, and snapshot
 * evidence speak the same path universe. Important guarantees:
 *
 *   - All paths flow through `resolveWorkspacePath()`. A
 *     `reserved-namespace` (`/_platform/**`) attempt produces a typed
 *     "path is in the reserved /_platform namespace" error rather than
 *     accidentally landing in workspace storage.
 *   - `mkdir` is **partial-with-disclosure** (AX-QNA Q21): the backend
 *     does not yet have a directory primitive, so `mkdir <path>` only
 *     ack-creates a prefix. The output explicitly says so and emits a
 *     stable structured `note: "mkdir-partial-no-directory-entity"`
 *     so reviewers / prompts cannot misread the result.
 *   - Reads from the workspace return either the file contents or
 *     `null` — null is converted to `No such file` exactly as before
 *     so existing E2E assertions are unchanged.
 */

import type { LocalCapabilityHandler } from "../targets/local-ts.js";
import {
  DEFAULT_WORKSPACE_ROOT,
  resolveWorkspacePath,
  type WorkspaceFsLike,
} from "./workspace-truth.js";

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
  namespace?: WorkspaceFsLike;
}

/**
 * The literal note emitted by the `mkdir` handler so prompt
 * disclosure / inventory text can grep for it. See AX-QNA Q21.
 */
export const MKDIR_PARTIAL_NOTE = "mkdir-partial-no-directory-entity";

/**
 * The literal note emitted by the `write` handler when the underlying
 * `WorkspaceFsLike.writeFile()` rejects with a typed
 * `ValueTooLargeError`-shaped error (see B1 spike-do-storage-F08
 * `docs/spikes/spike-do-storage/08-…` and the B2 typed error hierarchy
 * shipped in `@nano-agent/storage-topology` 2.0.0).
 *
 * The capability runtime intentionally does NOT import the error class
 * from `storage-topology` — it consumes the error STRUCTURALLY so the
 * package layering stays clean (capability-runtime depends on
 * `WorkspaceFsLike`, not on a specific storage adapter implementation).
 * A consumer that ships a different `WorkspaceFsLike` is welcome to
 * throw any object that satisfies `ValueTooLargeShape` to surface the
 * same disclosure.
 */
export const WRITE_OVERSIZE_REJECTED_NOTE = "write-oversize-rejected";

/**
 * Structural shape the write handler treats as "value-too-large".
 * Matches `@nano-agent/storage-topology`'s `ValueTooLargeError` (B2
 * 2.0.0) without importing it directly.
 */
interface ValueTooLargeShape {
  name: string;
  bytes: number;
  cap: number;
  adapter: string;
  message?: string;
}

function isValueTooLarge(err: unknown): err is ValueTooLargeShape {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  if (e.name !== "ValueTooLargeError") return false;
  return (
    typeof e.bytes === "number" &&
    typeof e.cap === "number" &&
    typeof e.adapter === "string"
  );
}

/**
 * Create filesystem capability handlers scoped to a workspace.
 *
 * @param namespace Configuration for the workspace. Currently accepts
 *   `{ workspacePath: string; namespace?: WorkspaceFsLike }`.
 */
export function createFilesystemHandlers(
  namespace: unknown,
): Map<string, LocalCapabilityHandler> {
  const config = isFilesystemHandlersConfig(namespace) ? namespace : undefined;
  const base = config?.workspacePath ?? DEFAULT_WORKSPACE_ROOT;
  const workspace = config?.namespace;

  const handlers = new Map<string, LocalCapabilityHandler>();

  function resolveOrThrow(prefix: string, raw: string): string {
    const result = resolveWorkspacePath(base, raw);
    if (result.ok) return result.path;
    if (result.error?.reason === "reserved-namespace") {
      throw new Error(
        `${prefix}: path '${result.error.path}' is in the reserved /_platform namespace`,
      );
    }
    throw new Error(`${prefix}: path '${raw}' escapes the workspace root`);
  }

  handlers.set("pwd", async () => ({ output: base }));

  handlers.set("ls", async (input) => {
    const { path = "." } = (input ?? {}) as PathInput;
    const resolved = resolveOrThrow("ls", path);
    if (workspace) {
      const entries = await workspace.listDir(resolved);
      return {
        output: entries
          .map((entry) => entry.path)
          .sort((a, b) => a.localeCompare(b))
          .join("\n"),
      };
    }
    return { output: `[ls] listing: ${resolved}` };
  });

  handlers.set("cat", async (input) => {
    const { path = "" } = (input ?? {}) as PathInput;
    if (!path) throw new Error("cat: no file path provided");
    const resolved = resolveOrThrow("cat", path);
    if (workspace) {
      const content = await workspace.readFile(resolved);
      if (content === null) {
        throw new Error(`cat: ${resolved}: No such file`);
      }
      return { output: content };
    }
    return { output: `[cat] reading: ${resolved}` };
  });

  handlers.set("write", async (input) => {
    const { path = "", content = "" } = (input ?? {}) as WriteInput;
    if (!path) throw new Error("write: no file path provided");
    const resolved = resolveOrThrow("write", path);
    if (workspace) {
      try {
        await workspace.writeFile(resolved, content);
      } catch (err) {
        if (isValueTooLarge(err)) {
          // Map the B2 typed truth to a deterministic capability-layer
          // disclosure. We never expose raw storage error strings (e.g.
          // SQLITE_TOOBIG) to the model — instead we restate the
          // contract with the marker so prompts / reviewers can grep.
          throw new Error(
            `write: oversize rejected — ${err.bytes} bytes exceeds the ${err.cap}-byte cap on the ${err.adapter} adapter (${WRITE_OVERSIZE_REJECTED_NOTE}; promote to a colder tier such as R2 before retrying, or split the payload).`,
          );
        }
        throw err;
      }
    }
    return { output: `[write] wrote ${content.length} bytes to ${resolved}` };
  });

  // mkdir — A8 P2-02 partial closure (Q21).
  // The current `WorkspaceFsLike` shape has no directory primitive, so
  // `mkdir` only ack-creates a prefix. The output line uses a fixed
  // marker so callers can grep for it and so PX inventory can describe
  // the limitation in the same words.
  handlers.set("mkdir", async (input) => {
    const { path = "" } = (input ?? {}) as PathInput;
    if (!path) throw new Error("mkdir: no directory path provided");
    const resolved = resolveOrThrow("mkdir", path);
    return {
      output: `[mkdir] partial: ack-only prefix ${resolved} (${MKDIR_PARTIAL_NOTE}; backend has no directory primitive — write a file under this prefix to make it visible to ls)`,
    };
  });

  handlers.set("rm", async (input) => {
    const { path = "" } = (input ?? {}) as PathInput;
    if (!path) throw new Error("rm: no path provided");
    const resolved = resolveOrThrow("rm", path);
    if (workspace) {
      const deleted = await workspace.deleteFile(resolved);
      if (!deleted) throw new Error(`rm: ${resolved}: No such file`);
    }
    return { output: `[rm] removed: ${resolved}` };
  });

  handlers.set("mv", async (input) => {
    const { source = "", destination = "" } = (input ?? {}) as TwoPathInput;
    if (!source || !destination) {
      throw new Error("mv: source and destination required");
    }
    const resolvedSrc = resolveOrThrow("mv", source);
    const resolvedDst = resolveOrThrow("mv", destination);
    if (workspace) {
      const content = await workspace.readFile(resolvedSrc);
      if (content === null) {
        throw new Error(`mv: ${resolvedSrc}: No such file`);
      }
      await workspace.writeFile(resolvedDst, content);
      await workspace.deleteFile(resolvedSrc);
    }
    return { output: `[mv] moved: ${resolvedSrc} -> ${resolvedDst}` };
  });

  handlers.set("cp", async (input) => {
    const { source = "", destination = "" } = (input ?? {}) as TwoPathInput;
    if (!source || !destination) {
      throw new Error("cp: source and destination required");
    }
    const resolvedSrc = resolveOrThrow("cp", source);
    const resolvedDst = resolveOrThrow("cp", destination);
    if (workspace) {
      const content = await workspace.readFile(resolvedSrc);
      if (content === null) {
        throw new Error(`cp: ${resolvedSrc}: No such file`);
      }
      await workspace.writeFile(resolvedDst, content);
    }
    return { output: `[cp] copied: ${resolvedSrc} -> ${resolvedDst}` };
  });

  return handlers;
}

function isFilesystemHandlersConfig(
  value: unknown,
): value is FilesystemHandlersConfig {
  if (!value || typeof value !== "object") return false;
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
