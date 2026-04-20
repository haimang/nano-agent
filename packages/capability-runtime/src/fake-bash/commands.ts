/**
 * Minimal Command Registration
 *
 * Registers the v1 command set into a CapabilityRegistry.
 * Each command is declared with appropriate kind, target, and policy.
 */

import type { CapabilityRegistry } from "../registry.js";
import type { CapabilityDeclaration } from "../types.js";

export interface RegisterMinimalCommandsOptions {
  readonly policyOverrides?: Partial<Record<string, CapabilityDeclaration["policy"]>>;
}

/** The v1 minimal command declarations. */
const MINIMAL_COMMANDS: readonly CapabilityDeclaration[] = [
  {
    name: "pwd",
    kind: "filesystem",
    description: "Print current working directory",
    inputSchema: {},
    executionTarget: "local-ts",
    policy: "allow",
  },
  {
    name: "ls",
    kind: "filesystem",
    description: "List directory contents",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
    executionTarget: "local-ts",
    policy: "allow",
  },
  {
    name: "cat",
    kind: "filesystem",
    description: "Read file contents",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
    executionTarget: "local-ts",
    policy: "allow",
  },
  {
    name: "write",
    kind: "filesystem",
    description: "Write content to a file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
    },
    executionTarget: "local-ts",
    policy: "ask",
  },
  {
    name: "mkdir",
    kind: "filesystem",
    description: "Create a directory",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
    executionTarget: "local-ts",
    policy: "ask",
  },
  {
    name: "rm",
    kind: "filesystem",
    description: "Remove a file or directory",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
    executionTarget: "local-ts",
    policy: "ask",
  },
  {
    name: "mv",
    kind: "filesystem",
    description: "Move or rename a file",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string" },
        destination: { type: "string" },
      },
    },
    executionTarget: "local-ts",
    policy: "ask",
  },
  {
    name: "cp",
    kind: "filesystem",
    description: "Copy a file",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string" },
        destination: { type: "string" },
      },
    },
    executionTarget: "local-ts",
    policy: "ask",
  },
  {
    name: "rg",
    kind: "search",
    description: "Search file contents using pattern matching",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
      },
    },
    executionTarget: "local-ts",
    policy: "allow",
  },
  {
    name: "curl",
    kind: "network",
    description: "Fetch a URL",
    inputSchema: { type: "object", properties: { url: { type: "string" } } },
    executionTarget: "local-ts",
    policy: "ask",
  },
  {
    name: "ts-exec",
    kind: "exec",
    description: "Execute TypeScript code in a controlled sandbox",
    inputSchema: { type: "object", properties: { code: { type: "string" } } },
    executionTarget: "local-ts",
    policy: "ask",
  },
  {
    name: "git",
    kind: "vcs",
    description: "Run a limited subset of git subcommands (status, diff, log)",
    inputSchema: {
      type: "object",
      properties: {
        subcommand: { type: "string" },
        args: { type: "array", items: { type: "string" } },
      },
    },
    executionTarget: "local-ts",
    policy: "allow",
  },
  // ── B3 wave 1 — text processing core (After-Foundations Phase 2) ──
  {
    name: "wc",
    kind: "filesystem",
    description: "Print line, word, and byte counts for a file",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
    },
    executionTarget: "local-ts",
    policy: "allow",
  },
  {
    name: "head",
    kind: "filesystem",
    description: "Print the first lines of a file (default 10)",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        lines: { type: "integer" },
        bytes: { type: "integer" },
      },
    },
    executionTarget: "local-ts",
    policy: "allow",
  },
  {
    name: "tail",
    kind: "filesystem",
    description: "Print the last lines of a file (default 10)",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        lines: { type: "integer" },
        bytes: { type: "integer" },
      },
    },
    executionTarget: "local-ts",
    policy: "allow",
  },
  {
    name: "jq",
    kind: "filesystem",
    description:
      "Worker-safe JSON query subset: ., .field, .a[N], .a[], keys, length",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" },
      },
    },
    executionTarget: "local-ts",
    policy: "allow",
  },
  {
    name: "sed",
    kind: "filesystem",
    description:
      "Worker-safe sed subset: single 's/PATTERN/REPLACEMENT/[gi]' substitution",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string" },
        path: { type: "string" },
      },
    },
    executionTarget: "local-ts",
    policy: "allow",
  },
  {
    name: "awk",
    kind: "filesystem",
    description:
      "Worker-safe awk subset: { print $N }, NR == K { print [...] }, /PATTERN/ { print [...] }",
    inputSchema: {
      type: "object",
      properties: {
        program: { type: "string" },
        path: { type: "string" },
      },
    },
    executionTarget: "local-ts",
    policy: "allow",
  },
  // ── B3 wave 2 — text processing aux ──
  {
    name: "sort",
    kind: "filesystem",
    description: "Sort lines of a file (lexicographic by default)",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        reverse: { type: "boolean" },
        numeric: { type: "boolean" },
        unique: { type: "boolean" },
      },
    },
    executionTarget: "local-ts",
    policy: "allow",
  },
  {
    name: "uniq",
    kind: "filesystem",
    description: "Collapse adjacent duplicate lines",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        count: { type: "boolean" },
      },
    },
    executionTarget: "local-ts",
    policy: "allow",
  },
  {
    name: "diff",
    kind: "filesystem",
    description: "Unified-style diff between two workspace files",
    inputSchema: {
      type: "object",
      properties: {
        left: { type: "string" },
        right: { type: "string" },
      },
    },
    executionTarget: "local-ts",
    policy: "allow",
  },
];

/**
 * Register the minimal v1 command set into the provided registry.
 *
 * Callers may override the default policy of individual commands without
 * mutating the canonical declaration list.
 */
export function registerMinimalCommands(
  registry: CapabilityRegistry,
  options?: RegisterMinimalCommandsOptions,
): void {
  for (const decl of MINIMAL_COMMANDS) {
    const override = options?.policyOverrides?.[decl.name];
    registry.register(
      override && override !== decl.policy ? { ...decl, policy: override } : decl,
    );
  }
}

/**
 * A10 Phase 3 — inventory disclosure helpers (Q19 ask-gated orthogonal
 * dimension). Both helpers read the canonical declaration list so the
 * answer never drifts from the registry truth.
 */

/** Return the minimal command declarations in canonical order. */
export function getMinimalCommandDeclarations(): readonly CapabilityDeclaration[] {
  return MINIMAL_COMMANDS;
}

/** Return every command name whose canonical policy is `ask`. */
export function getAskGatedCommands(): readonly string[] {
  return MINIMAL_COMMANDS.filter((d) => d.policy === "ask").map((d) => d.name);
}

/** Return every command name whose canonical policy is `allow`. */
export function getAllowGatedCommands(): readonly string[] {
  return MINIMAL_COMMANDS.filter((d) => d.policy === "allow").map((d) => d.name);
}
