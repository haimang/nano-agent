/**
 * @nano-agent/hooks — simple event matchers (no regex).
 *
 * Supports exact, wildcard ("*"), and toolName matching.
 * An undefined matcher matches everything (default handler).
 */

import type { HookMatcherConfig } from "./types.js";

export type MatcherKind = "exact" | "wildcard" | "toolName";

/**
 * Determine whether a handler's matcher config matches the given event name
 * and optional context.
 *
 * - `exact`:    config.value === eventName
 * - `wildcard`: config.value === "*" (matches all events)
 * - `toolName`: matches if context.toolName === config.value
 *               (intended for PreToolUse / PostToolUse filtering)
 * - undefined:  matches everything (default/catch-all handler)
 */
export function matchEvent(
  config: HookMatcherConfig | undefined,
  eventName: string,
  context?: { toolName?: string },
): boolean {
  if (config === undefined) {
    return true;
  }

  switch (config.type) {
    case "exact":
      return config.value === eventName;

    case "wildcard":
      return config.value === "*";

    case "toolName":
      return context?.toolName === config.value;

    default:
      return false;
  }
}
