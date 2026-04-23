/**
 * Core Capability Types
 *
 * Defines the fundamental shapes for capability declarations, execution
 * planning, and metadata.  Inspired by codex-rs/tools ToolDefinition and
 * claude-code/utils/hooks PreToolUse event patterns.
 */

/** Broad classification of what a capability does. */
export type CapabilityKind =
  | "filesystem"
  | "search"
  | "network"
  | "exec"
  | "vcs"
  | "browser"
  | "custom";

/** Where the capability implementation runs. */
export type ExecutionTarget = "local-ts" | "service-binding" | "browser-rendering";

/** Policy outcome for a capability invocation. */
export type PolicyDecision = "allow" | "ask" | "deny" | "hook-gated";

/**
 * Static declaration of a capability that can be registered and discovered.
 *
 * The `inputSchema` is deliberately typed as `unknown` here;
 * callers should validate with zod or JSON-Schema at runtime.
 */
export interface CapabilityDeclaration {
  readonly name: string;
  readonly kind: CapabilityKind;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly executionTarget: ExecutionTarget;
  readonly policy: PolicyDecision;
  readonly deferLoading?: boolean;
  readonly mimeTypes?: string[];
}

/**
 * An execution plan produced by the planner before a capability runs.
 *
 * Separates the "what to do" from the "how to do it" so the policy
 * layer can inspect or gate the plan before execution begins.
 */
export interface CapabilityPlan {
  readonly capabilityName: string;
  readonly input: unknown;
  readonly executionTarget: ExecutionTarget;
  readonly source: "bash-command" | "structured-tool";
  readonly rawCommand?: string;
}

/**
 * Runtime metadata about a registered capability.
 *
 * Used for introspection, degradation signalling, and TUI display.
 */
export interface CapabilityMetadata {
  readonly name: string;
  readonly kind: CapabilityKind;
  readonly description: string;
  readonly supportedFlags?: string[];
  readonly unsupported?: boolean;
  readonly degraded?: boolean;
  readonly degradedReason?: string;
}
