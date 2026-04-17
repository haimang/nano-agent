/**
 * @nano-agent/hooks — base types for hook handler configuration.
 *
 * HookSource identifies where a hook registration originates.
 * HookRuntimeKind determines how the handler is executed.
 * HookHandlerConfig is the full descriptor for a registered hook handler.
 */

import type { HookEventName } from "./catalog.js";

/** Where a hook registration originates. "skill" is deferred for v1. */
export type HookSource = "platform-policy" | "session" | "skill";

/** How the handler is executed at dispatch time. */
export type HookRuntimeKind = "local-ts" | "service-binding";

/** Matcher configuration for filtering which events a handler receives. */
export interface HookMatcherConfig {
  readonly type: "exact" | "wildcard" | "toolName";
  readonly value: string;
}

/**
 * Full descriptor for a registered hook handler.
 *
 * `event` is a strict `HookEventName` literal — unknown event names cannot
 * be registered at compile time. This guards against typos that would
 * otherwise register a handler that is never invoked.
 */
export interface HookHandlerConfig {
  readonly id: string;
  readonly source: HookSource;
  readonly event: HookEventName;
  readonly matcher?: HookMatcherConfig;
  readonly runtime: HookRuntimeKind;
  readonly timeoutMs?: number;
  readonly description?: string;
}
