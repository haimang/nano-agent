/**
 * Capability Policy Gate
 *
 * Single entry point for execution approval. Inspects a CapabilityPlan
 * and returns a PolicyDecision controlling whether execution proceeds.
 */

import type { CapabilityPlan, PolicyDecision } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";

/** Context optionally provided to the policy gate for hook-based decisions. */
export interface PolicyContext {
  hookOutcome?: unknown;
}

/**
 * CapabilityPolicyGate inspects capability plans and returns policy decisions.
 *
 * In the current implementation, it reads the policy from the capability
 * declaration. Hook-gated overrides can be supplied via context.
 */
export class CapabilityPolicyGate {
  constructor(private registry: CapabilityRegistry) {}

  /**
   * Check whether a plan should be allowed to execute.
   *
   * Resolution order:
   * 1. If context.hookOutcome is "allow" or "deny", honour it (hook-gated).
   * 2. Otherwise, fall back to the capability declaration's static policy.
   * 3. If the capability is not registered, deny.
   */
  async check(
    plan: CapabilityPlan,
    context?: PolicyContext,
  ): Promise<PolicyDecision> {
    // Hook override takes precedence
    if (context?.hookOutcome === "allow") return "allow";
    if (context?.hookOutcome === "deny") return "deny";

    // Look up the declaration's static policy
    const decl = this.registry.get(plan.capabilityName);
    if (!decl) {
      return "deny";
    }

    return decl.policy;
  }
}
