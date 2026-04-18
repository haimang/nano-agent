/**
 * Search Capability Handler — A8 Phase 3 minimal `rg` reality.
 *
 * Q15 freezes `rg` as the v1 canonical search command. This handler is
 * intentionally a faithful but minimal subset:
 *
 *   - Walks the workspace via `WorkspaceFsLike.listDir` recursively
 *     starting from the resolved input path.
 *   - Reads each text file via `WorkspaceFsLike.readFile` and matches
 *     line-by-line against the supplied regex (string scan when the
 *     pattern is not a valid regex falls back to plain substring).
 *   - Returns line-prefixed matches in the canonical
 *     `path:lineNumber:line` format that ripgrep speaks, sorted by
 *     path+line for deterministic output.
 *   - Honours `/_platform/**` reservation: descendants of the reserved
 *     namespace are silently skipped, never matched.
 *   - Hard caps inline output (`maxMatches` lines, `maxBytes` bytes).
 *     When the cap fires the result includes a trailing
 *     `[rg] truncated: …` line — the cap is part of the contract,
 *     not silent.
 *
 * Q16: a top-level alias surface (`grep`) lives in
 * `fake-bash/commands.ts` + `planner.ts`; both ultimately route to
 * this handler so canonical truth stays single-sourced.
 */

import type { LocalCapabilityHandler } from "../targets/local-ts.js";
import {
  DEFAULT_WORKSPACE_ROOT,
  isReservedNamespacePath,
  resolveWorkspacePath,
  type WorkspaceFsLike,
} from "./workspace-truth.js";

interface SearchInput {
  pattern?: string;
  path?: string;
  /** Override the default 200-line / 32 KB cap for tests. */
  maxMatches?: number;
  maxBytes?: number;
}

interface SearchHandlersConfig {
  workspacePath?: string;
  namespace?: WorkspaceFsLike;
}

/** Default per-call cap on inline matches. */
export const DEFAULT_RG_MAX_MATCHES = 200;
/** Default per-call cap on the inline byte payload. */
export const DEFAULT_RG_MAX_BYTES = 32 * 1024;

const TEXT_ENCODER = new TextEncoder();
function utf8ByteLength(s: string): number {
  return TEXT_ENCODER.encode(s).byteLength;
}

export function createSearchHandlers(
  config?: SearchHandlersConfig,
): Map<string, LocalCapabilityHandler> {
  const handlers = new Map<string, LocalCapabilityHandler>();
  const base = config?.workspacePath ?? DEFAULT_WORKSPACE_ROOT;
  const workspace = config?.namespace;

  handlers.set("rg", async (input) => {
    const opts = (input ?? {}) as SearchInput;
    const pattern = opts.pattern ?? "";
    if (!pattern) throw new Error("rg: no search pattern provided");

    const startPath = opts.path ?? ".";
    const resolved = resolveWorkspacePath(base, startPath);
    if (!resolved.ok) {
      if (resolved.error?.reason === "reserved-namespace") {
        throw new Error(
          `rg: path '${resolved.error.path}' is in the reserved /_platform namespace`,
        );
      }
      throw new Error(`rg: path '${startPath}' escapes the workspace root`);
    }

    let matcher: (line: string) => boolean;
    try {
      const re = new RegExp(pattern);
      matcher = (line: string) => re.test(line);
    } catch {
      // Fall back to plain substring on invalid regex; mirrors `rg -F`.
      matcher = (line: string) => line.includes(pattern);
    }

    const maxMatches = opts.maxMatches ?? DEFAULT_RG_MAX_MATCHES;
    const maxBytes = opts.maxBytes ?? DEFAULT_RG_MAX_BYTES;

    if (!workspace) {
      // Stub fallback for callers that wired the search handler with
      // no namespace (older tests / smokes). Deterministic, easy to
      // grep for in logs.
      return {
        output: `[rg] no workspace bound; pattern="${pattern}" path=${resolved.path}`,
      };
    }

    const queue: string[] = [resolved.path];
    const visited = new Set<string>();
    const matches: string[] = [];
    let bytesEmitted = 0;
    let totalMatches = 0;
    let truncated = false;

    while (queue.length > 0) {
      const next = queue.shift()!;
      if (visited.has(next)) continue;
      visited.add(next);
      if (isReservedNamespacePath(next)) continue;

      let entries: Array<{ path: string; size: number }>;
      try {
        entries = await workspace.listDir(next);
      } catch {
        entries = [{ path: next, size: 0 }];
      }
      const treatAsFile = entries.length === 0;
      const candidates = treatAsFile ? [next] : entries.map((e) => e.path);

      candidates.sort((a, b) => a.localeCompare(b));
      for (const candidate of candidates) {
        if (isReservedNamespacePath(candidate)) continue;
        // Recurse into directories: heuristic = path without an
        // extension and not the same as the parent we just listed.
        const looksDirectory =
          !treatAsFile && !candidate.includes(".") && candidate !== next;
        if (looksDirectory) {
          queue.push(candidate);
          continue;
        }
        const content = await workspace.readFile(candidate).catch(() => null);
        if (content === null) continue;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (!matcher(line)) continue;
          totalMatches += 1;
          if (matches.length >= maxMatches || bytesEmitted >= maxBytes) {
            truncated = true;
            continue;
          }
          const formatted = `${candidate}:${i + 1}:${line}`;
          const formattedBytes = utf8ByteLength(formatted) + 1;
          if (bytesEmitted + formattedBytes > maxBytes) {
            truncated = true;
            continue;
          }
          bytesEmitted += formattedBytes;
          matches.push(formatted);
        }
      }
    }

    matches.sort((a, b) => a.localeCompare(b));
    if (truncated) {
      matches.push(
        `[rg] truncated: ${totalMatches} matches over the cap of ${maxMatches} lines / ${maxBytes} bytes; rerun with a narrower path or pattern`,
      );
    }

    return {
      output:
        matches.length > 0
          ? matches.join("\n")
          : `[rg] no matches for pattern="${pattern}" under ${resolved.path}`,
    };
  });

  return handlers;
}
