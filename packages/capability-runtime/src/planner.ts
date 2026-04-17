/**
 * Command Planner
 *
 * Maps bash-shaped commands OR structured tool calls to CapabilityPlan.
 * This is the bridge between user intent (expressed as shell commands or
 * tool invocations) and the typed capability execution layer.
 */

import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityPlan } from "./types.js";

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
 * Plan a capability execution from a bash-shaped command string.
 *
 * Returns null if the command is not recognized in the registry.
 */
export function planFromBashCommand(
  command: string,
  registry: CapabilityRegistry,
): CapabilityPlan | null {
  const { command: cmd, args } = parseSimpleCommand(command);

  if (!cmd || !registry.has(cmd)) {
    return null;
  }

  const decl = registry.get(cmd)!;

  // Build input based on the command kind
  const input = buildInputFromArgs(cmd, args);

  return {
    capabilityName: cmd,
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
