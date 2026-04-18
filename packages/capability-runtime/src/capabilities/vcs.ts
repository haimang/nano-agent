/**
 * VCS (Version Control System) Capability Handler — A10 `git` baseline.
 *
 * Q18 bindings (docs/action-plan/after-skeleton/AX-QNA.md):
 *   - v1 `git` is frozen to the read-only introspection trio
 *     `status / diff / log`. Any other subcommand is Deferred and must
 *     fail at the planner/handler with a typed marker — NEVER silently
 *     succeed.
 *   - The implementation stays honest partial: there is no virtual
 *     index / ref / history model yet. Each subcommand returns a
 *     deterministic baseline that talks about the `workspace` reality
 *     instead of fabricating commit SHAs.
 *
 * Output markers (greppable by prompts / inventory / tests):
 *   - `git-partial-no-history`   — `log` cannot yet produce commit history
 *   - `git-partial-no-baseline`  — `diff` has no checkpoint to compare against
 *   - `git-subcommand-blocked`   — a non-`status/diff/log` subcommand was used
 *
 * Future upgrade path: when a virtual workspace-snapshot checkpoint
 * model is introduced, these markers can be lifted and `status` / `diff`
 * will produce real change-set output. That work is intentionally out
 * of A10 scope (Q18 rationale: mutating git needs virtual index / ref /
 * history design, which is Phase 8+).
 */

import type { LocalCapabilityHandler } from "../targets/local-ts.js";
import {
  DEFAULT_WORKSPACE_ROOT,
  isReservedNamespacePath,
  resolveWorkspacePathOrThrow,
  type WorkspaceFsLike,
} from "./workspace-truth.js";

/** The only sanctioned `git` subcommands in v1. */
export const GIT_SUPPORTED_SUBCOMMANDS: readonly string[] = [
  "status",
  "diff",
  "log",
];

const GIT_SUBCOMMAND_SET: ReadonlySet<string> = new Set(
  GIT_SUPPORTED_SUBCOMMANDS,
);

export const GIT_SUBCOMMAND_BLOCKED_NOTE = "git-subcommand-blocked";
export const GIT_PARTIAL_NO_HISTORY_NOTE = "git-partial-no-history";
export const GIT_PARTIAL_NO_BASELINE_NOTE = "git-partial-no-baseline";

export function isSupportedGitSubcommand(name: string): boolean {
  return GIT_SUBCOMMAND_SET.has(name);
}

export interface CreateVcsHandlersOptions {
  /** Workspace root — defaults to `/workspace` per workspace-truth v1. */
  workspacePath?: string;
  /** Namespace-backed filesystem. When absent, returns legacy stub output. */
  namespace?: WorkspaceFsLike;
}

interface GitInput {
  subcommand?: string;
  args?: string[];
}

async function listWorkspace(
  namespace: WorkspaceFsLike,
  root: string,
): Promise<string[]> {
  const out: string[] = [];
  async function walk(path: string): Promise<void> {
    if (isReservedNamespacePath(path)) return;
    const entries = await namespace.listDir(path);
    for (const entry of entries) {
      if (isReservedNamespacePath(entry.path)) continue;
      // `listDir` returns child paths; recurse into "directories" by
      // checking whether the child has its own children.
      const children = await namespace.listDir(entry.path);
      if (children.length > 0) {
        await walk(entry.path);
      } else {
        out.push(entry.path);
      }
    }
  }
  await walk(root);
  out.sort();
  return out;
}

/**
 * Create VCS capability handlers.
 *
 * Returns a Map with a "git" handler that services only the frozen
 * `status / diff / log` subset and emits typed markers for every
 * refusal so prompt / inventory / tests can check the contract is
 * still honoured.
 */
export function createVcsHandlers(
  options: CreateVcsHandlersOptions = {},
): Map<string, LocalCapabilityHandler> {
  const handlers = new Map<string, LocalCapabilityHandler>();
  const workspaceRoot = options.workspacePath ?? DEFAULT_WORKSPACE_ROOT;
  const namespace = options.namespace;

  handlers.set("git", async (input) => {
    const { subcommand = "", args = [] } = (input ?? {}) as GitInput;

    if (!subcommand) {
      throw new Error("git: no subcommand provided");
    }

    if (!isSupportedGitSubcommand(subcommand)) {
      throw new Error(
        `git: subcommand "${subcommand}" is not supported (${GIT_SUBCOMMAND_BLOCKED_NOTE}; v1 subset = ${GIT_SUPPORTED_SUBCOMMANDS.join("/")}; AX-QNA Q18).`,
      );
    }

    // `args` only affects the *display* of the command footer — subset
    // validation has already happened above, and the bash planner
    // passes through extra tokens verbatim.
    const footer = args.length > 0 ? ` (args: ${args.join(" ")})` : "";

    switch (subcommand) {
      case "status": {
        if (!namespace) {
          return {
            output:
              `[git status] partial: workspace not wired; no namespace attached${footer}`,
          };
        }
        const resolved = resolveWorkspacePathOrThrow(workspaceRoot, ".");
        const files = await listWorkspace(namespace, resolved);
        const header = files.length === 0
          ? `[git status] clean workspace (root ${resolved}; 0 tracked-like entries)`
          : `[git status] ${files.length} workspace entries under ${resolved} (read-only view; v1 has no index)`;
        const body = files.length === 0 ? "" : `\n${files.join("\n")}`;
        return { output: `${header}${footer}${body}` };
      }
      case "diff": {
        return {
          output:
            `[git diff] partial: no checkpoint baseline yet (${GIT_PARTIAL_NO_BASELINE_NOTE}; v1 is read-only introspection — virtual index/ref model is Phase 8+)${footer}`,
        };
      }
      case "log": {
        return {
          output:
            `[git log] partial: no commit history yet (${GIT_PARTIAL_NO_HISTORY_NOTE}; session-timeline-based log is reserved for a future virtual VCS worker)${footer}`,
        };
      }
    }
    // Defensive guard — should be unreachable because the set check
    // above already returned on an unknown subcommand.
    throw new Error(`git: unreachable subcommand "${subcommand}"`);
  });

  return handlers;
}
