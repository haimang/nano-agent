/**
 * @nano-agent/hooks — the 8-event hook catalog.
 *
 * Defines the full set of lifecycle hook events, their blocking semantics,
 * allowed outcome actions, and payload schema references. Inspired by
 * claude-code's hook event model (PreToolUse, PostToolUse, etc.).
 *
 * The `allowedOutcomes` for each event is the frozen truth used by the
 * outcome reducer and the session mapper — NEVER let it drift from
 * `docs/design/hooks-by-GPT.md §7.2` or `docs/action-plan/hooks.md §2.3`.
 */

/** The 8 canonical hook event names. */
export type HookEventName =
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PreCompact"
  | "PostCompact";

/** Metadata describing a single hook event's dispatch semantics. */
export interface HookEventMeta {
  /** Whether the dispatcher must await all handlers before continuing. */
  readonly blocking: boolean;
  /** The outcome action / field names that handlers may return for this event. */
  readonly allowedOutcomes: readonly string[];
  /** Reference name for the payload schema (for documentation/validation). */
  readonly payloadSchema: string;
  /** Hints for fields that should be redacted in audit logs. */
  readonly redactionHints: readonly string[];
}

/**
 * The canonical hook-event catalog.
 *
 * Each entry maps an event name to its dispatch metadata. Blocking events
 * require the dispatcher to await all handlers and respect their outcomes
 * before continuing the agent loop.
 */
export const HOOK_EVENT_CATALOG: Readonly<Record<HookEventName, HookEventMeta>> = {
  SessionStart: {
    blocking: false,
    allowedOutcomes: ["additionalContext", "diagnostics"],
    payloadSchema: "SessionStartPayload",
    redactionHints: [],
  },
  SessionEnd: {
    blocking: false,
    allowedOutcomes: ["diagnostics"],
    payloadSchema: "SessionEndPayload",
    redactionHints: [],
  },
  // Design §7.2: UserPromptSubmit is governance-only; `updatedInput` is
  // intentionally NOT allowed here — only `PreToolUse` may reshape input.
  UserPromptSubmit: {
    blocking: true,
    allowedOutcomes: ["block", "additionalContext", "diagnostics"],
    payloadSchema: "UserPromptSubmitPayload",
    redactionHints: ["user_input"],
  },
  PreToolUse: {
    blocking: true,
    allowedOutcomes: ["block", "updatedInput", "additionalContext", "diagnostics"],
    payloadSchema: "PreToolUsePayload",
    redactionHints: ["tool_input"],
  },
  PostToolUse: {
    blocking: false,
    allowedOutcomes: ["additionalContext", "diagnostics"],
    payloadSchema: "PostToolUsePayload",
    redactionHints: ["tool_output"],
  },
  // Design §7.2: PostToolUseFailure may request `stop` so a failing tool
  // can halt the agent loop cleanly.
  PostToolUseFailure: {
    blocking: false,
    allowedOutcomes: ["additionalContext", "stop", "diagnostics"],
    payloadSchema: "PostToolUseFailurePayload",
    redactionHints: ["error_details"],
  },
  PreCompact: {
    blocking: true,
    allowedOutcomes: ["block", "diagnostics"],
    payloadSchema: "PreCompactPayload",
    redactionHints: [],
  },
  // Design §7.2: PostCompact may add context (e.g. a summary reference)
  // that the next turn sees.
  PostCompact: {
    blocking: false,
    allowedOutcomes: ["additionalContext", "diagnostics"],
    payloadSchema: "PostCompactPayload",
    redactionHints: [],
  },
} as const;

/** Returns true if the given event blocks the agent loop until handlers complete. */
export function isBlockingEvent(name: HookEventName): boolean {
  return HOOK_EVENT_CATALOG[name].blocking;
}
