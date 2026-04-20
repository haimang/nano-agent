/**
 * Context-Management — Budget submodule public API.
 */

export type {
  BufferPolicy,
  CompactPolicy,
  CompactPolicyOverride,
  CategoryUsage,
  UsageSnapshot,
} from "./types.js";

export {
  DEFAULT_COMPACT_POLICY,
  mergeCompactPolicy,
  effectivePromptBudget,
  usagePct,
  headroomTokens,
  shouldArm,
  shouldHardFallback,
} from "./policy.js";

export { applyEnvOverride } from "./env.js";
export type { EnvLike, ApplyEnvOverrideOptions } from "./env.js";
