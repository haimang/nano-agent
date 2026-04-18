/**
 * Command Planner
 *
 * Maps bash-shaped commands OR structured tool calls to CapabilityPlan.
 * This is the bridge between user intent (expressed as shell commands or
 * tool invocations) and the typed capability execution layer.
 */

import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityPlan } from "./types.js";
import {
  GIT_SUBCOMMAND_BLOCKED_NOTE,
  GIT_SUPPORTED_SUBCOMMANDS,
  isSupportedGitSubcommand,
} from "./capabilities/vcs.js";

/**
 * Parse a simple shell-like command string into command + args.
 *
 * Handles double-quoted and single-quoted arguments.
 * Does NOT handle escapes, pipes, redirects, or subshells.
 */
export function parseSimpleCommand(raw: string): {
  command: string;
  args: string[];
} {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { command: "", args: [] };
  }

  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === " " && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  const command = tokens[0] ?? "";
  const args = tokens.slice(1);
  return { command, args };
}

/**
 * A8 P3-02 — narrow command aliases (Q16).
 *
 * Maps a bash-side keyword to the canonical capability name. Aliases
 * MUST stay narrow (single-name → single-canonical) — anything richer
 * belongs to a structured tool call, not the bash surface. Today the
 * only sanctioned alias is `grep -> rg`; `egrep / fgrep` remain
 * out-of-scope per the action plan.
 */
export const COMMAND_ALIASES: Record<string, string> = {
  grep: "rg",
};

type AliasRewrite =
  | { ok: true; canonical: string; args: string[] }
  | { ok: false; reason: string };

function parseAliasArgs(cmd: string, args: string[]): AliasRewrite {
  const canonical = COMMAND_ALIASES[cmd];
  if (!canonical) return { ok: true, canonical: cmd, args };
  if (cmd === "grep") {
    if (args.length === 0) {
      return {
        ok: false,
        reason:
          "grep: pattern required; alias rewrites to `rg <pattern> [path]`",
      };
    }
    if (args[0]!.startsWith("-")) {
      return {
        ok: false,
        reason: `grep alias is intentionally narrow (Q16). Drop the '${args[0]}' flag and call \`rg\` directly for richer options.`,
      };
    }
    return { ok: true, canonical, args };
  }
  return { ok: true, canonical, args };
}

/**
 * A9 Phase 1 — bash-path narrow surface for high-risk commands (Q17).
 *
 * `curl` on the bash path is frozen to `curl <url>`. Any additional
 * positional arg or `-flag` indicates the caller is trying to smuggle
 * richer method / header / body / timeout semantics through bash
 * argv, which Q17 forbids. Redirect those callers to the structured
 * tool call with the `{ url, method, headers, body, timeoutMs }`
 * schema.
 *
 * `ts-exec` on the bash path collapses every trailing token into the
 * `code` field (per existing behaviour) but rejects leading `-flags`
 * so the surface stays predictable.
 */
export const CURL_BASH_NARROW_NOTE = "curl-bash-narrow-use-structured";
export const TS_EXEC_BASH_NARROW_NOTE = "ts-exec-bash-narrow-no-flags";

type BashNarrowCheck = { ok: true } | { ok: false; reason: string };

function checkBashNarrow(cmd: string, args: string[]): BashNarrowCheck {
  if (cmd === "curl") {
    if (args.length === 0) {
      return {
        ok: false,
        reason:
          "curl: URL required. Bash path is intentionally narrow (Q17); use `curl <url>`.",
      };
    }
    if (args[0]!.startsWith("-")) {
      return {
        ok: false,
        reason:
          `curl: bash path is intentionally narrow (Q17). Drop '${args[0]}' and use the structured tool call with { url, method, headers, body, timeoutMs } (${CURL_BASH_NARROW_NOTE}).`,
      };
    }
    if (args.length > 1) {
      return {
        ok: false,
        reason:
          `curl: bash path only supports \`curl <url>\` (Q17). Use the structured tool call with { url, method, headers, body, timeoutMs } for richer options (${CURL_BASH_NARROW_NOTE}).`,
      };
    }
    return { ok: true };
  }
  if (cmd === "ts-exec") {
    if (args.length === 0) {
      return {
        ok: false,
        reason: "ts-exec: code required. Use `ts-exec <inline code>`.",
      };
    }
    if (args[0]!.startsWith("-")) {
      return {
        ok: false,
        reason:
          `ts-exec: bash path accepts only an inline code string (${TS_EXEC_BASH_NARROW_NOTE}). Drop '${args[0]}' and call the structured tool call if richer options are ever added.`,
      };
    }
    return { ok: true };
  }
  if (cmd === "git") {
    if (args.length === 0) {
      return {
        ok: false,
        reason: `git: subcommand required; v1 subset = ${GIT_SUPPORTED_SUBCOMMANDS.join("/")} (AX-QNA Q18).`,
      };
    }
    const sub = args[0]!;
    if (!isSupportedGitSubcommand(sub)) {
      return {
        ok: false,
        reason:
          `git: subcommand "${sub}" is not supported (${GIT_SUBCOMMAND_BLOCKED_NOTE}; v1 subset = ${GIT_SUPPORTED_SUBCOMMANDS.join("/")}; mutating subcommands are Deferred per AX-QNA Q18).`,
      };
    }
    return { ok: true };
  }
  return { ok: true };
}

/**
 * Plan a capability execution from a bash-shaped command string.
 *
 * Returns null if the command is not recognized in the registry, and
 * throws when a narrow alias (e.g. `grep`) is used with an
 * unsupported flag set.
 */
export function planFromBashCommand(
  command: string,
  registry: CapabilityRegistry,
): CapabilityPlan | null {
  const { command: cmd, args } = parseSimpleCommand(command);
  if (!cmd) return null;

  const rewrite = parseAliasArgs(cmd, args);
  if (!rewrite.ok) {
    throw new Error(rewrite.reason);
  }

  const canonical = rewrite.canonical;
  if (!registry.has(canonical)) return null;

  const narrow = checkBashNarrow(canonical, rewrite.args);
  if (!narrow.ok) {
    throw new Error(narrow.reason);
  }

  const decl = registry.get(canonical)!;
  const input = buildInputFromArgs(canonical, rewrite.args);

  return {
    capabilityName: canonical,
    input,
    executionTarget: decl.executionTarget,
    source: "bash-command",
    rawCommand: command,
  };
}

/**
 * Plan a capability execution from a structured tool call.
 *
 * Returns null if the tool name is not recognized in the registry.
 */
export function planFromToolCall(
  name: string,
  args: unknown,
  registry: CapabilityRegistry,
): CapabilityPlan | null {
  if (!registry.has(name)) {
    return null;
  }

  const decl = registry.get(name)!;

  return {
    capabilityName: name,
    input: args,
    executionTarget: decl.executionTarget,
    source: "structured-tool",
  };
}

/**
 * Build a structured input object from positional args based on the command name.
 */
function buildInputFromArgs(
  cmd: string,
  args: string[],
): Record<string, unknown> {
  switch (cmd) {
    case "ls":
      return { path: args[0] ?? "." };
    case "cat":
      return { path: args[0] ?? "" };
    case "write":
      return { path: args[0] ?? "", content: args.slice(1).join(" ") };
    case "mkdir":
      return { path: args[0] ?? "" };
    case "rm":
      return { path: args[0] ?? "" };
    case "mv":
      return { source: args[0] ?? "", destination: args[1] ?? "" };
    case "cp":
      return { source: args[0] ?? "", destination: args[1] ?? "" };
    case "pwd":
      return {};
    case "rg":
      return { pattern: args[0] ?? "", path: args[1] ?? "." };
    case "curl":
      return { url: args[0] ?? "" };
    case "ts-exec":
      return { code: args.join(" ") };
    case "git":
      return { subcommand: args[0] ?? "", args: args.slice(1) };
    default:
      return { args };
  }
}
