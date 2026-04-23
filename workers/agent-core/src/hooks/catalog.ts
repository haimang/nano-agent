import {
  HOOK_EVENT_PAYLOAD_SCHEMA_NAMES,
  type HookEventName,
} from "@haimang/nacp-core";

/**
 * @nano-agent/hooks — the v2 hook event catalog (18 events across 3 classes).
 *
 * Defines the full set of lifecycle hook events, their blocking semantics,
 * allowed outcome actions, and payload schema references. Inspired by
 * claude-code's hook event model (PreToolUse, PostToolUse, etc.).
 *
 * **B5 expansion (2026-04-20)** — from the initial 8-event baseline to 18
 * events across three classes:
 *
 *   - **Class A (8, unchanged)** — SessionStart / SessionEnd /
 *     UserPromptSubmit / PreToolUse / PostToolUse / PostToolUseFailure /
 *     PreCompact / PostCompact. Allowlists unchanged; existing tests
 *     stay green.
 *   - **Class B (4, new)** — `Setup` / `Stop` / `PermissionRequest` /
 *     `PermissionDenied`. Startup/shutdown seams and capability ask-gated
 *     permission seam.
 *   - **Class D (6, new)** — `ContextPressure` /
 *     `ContextCompactArmed` / `ContextCompactPrepareStarted` /
 *     `ContextCompactCommitted` / `ContextCompactFailed` /
 *     `EvalSinkOverflow`. Async-compact lifecycle + eval-sink overflow
 *     disclosure.
 *
 * Class C (`FileChanged` / `CwdChanged`) is intentionally deferred to B7
 * per P4-hooks-catalog-expansion §5.
 *
 * **Wire truth note (PermissionRequest)** — per B5 action-plan §2.3 we do
 * NOT invent `allow` / `deny` actions in the wire. The permission verdict
 * rides on the existing `continue` (= allow) / `block` (= deny) actions,
 * and the caller fails closed when there is no handler. See
 * `permission.ts` for the package-local `verdictOf()` helper.
 *
 * The `allowedOutcomes` for each event is the frozen truth used by the
 * outcome reducer and the session mapper — NEVER let it drift from
 * `docs/design/after-foundations/P4-hooks-catalog-expansion.md §3-§7`.
 */

/**
 * @deprecated Import `HookEventName` from `@haimang/nacp-core`.
 * Planned removal: worker-matrix P0 absorption phase (target 2026-Q3).
 */
export type { HookEventName } from "@haimang/nacp-core";

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
  // ══════════════════════════════════════════════════════════════════
  // §A — Class A (8, unchanged)
  // ══════════════════════════════════════════════════════════════════
  SessionStart: {
    blocking: false,
    allowedOutcomes: ["additionalContext", "diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.SessionStart,
    redactionHints: [],
  },
  SessionEnd: {
    blocking: false,
    allowedOutcomes: ["diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.SessionEnd,
    redactionHints: [],
  },
  // Design §7.2: UserPromptSubmit is governance-only; `updatedInput` is
  // intentionally NOT allowed here — only `PreToolUse` may reshape input.
  UserPromptSubmit: {
    blocking: true,
    allowedOutcomes: ["block", "additionalContext", "diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.UserPromptSubmit,
    redactionHints: ["user_input"],
  },
  PreToolUse: {
    blocking: true,
    allowedOutcomes: ["block", "updatedInput", "additionalContext", "diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.PreToolUse,
    redactionHints: ["tool_input"],
  },
  PostToolUse: {
    blocking: false,
    allowedOutcomes: ["additionalContext", "diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.PostToolUse,
    redactionHints: ["tool_output"],
  },
  // Design §7.2: PostToolUseFailure may request `stop` so a failing tool
  // can halt the agent loop cleanly.
  PostToolUseFailure: {
    blocking: false,
    allowedOutcomes: ["additionalContext", "stop", "diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.PostToolUseFailure,
    redactionHints: ["error_details"],
  },
  PreCompact: {
    blocking: true,
    allowedOutcomes: ["block", "diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.PreCompact,
    redactionHints: [],
  },
  // Design §7.2: PostCompact may add context (e.g. a summary reference)
  // that the next turn sees.
  PostCompact: {
    blocking: false,
    allowedOutcomes: ["additionalContext", "diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.PostCompact,
    redactionHints: [],
  },

  // ══════════════════════════════════════════════════════════════════
  // §B — Class B (4, new)
  // ══════════════════════════════════════════════════════════════════

  // Actor/runtime startup, distinct from `SessionStart` (which is turn
  // lifecycle). `Setup` fires once per actor attachment BEFORE the first
  // `SessionStart`, giving platform-policy hooks a seam to inject
  // pre-loaded secrets / environment shims.
  Setup: {
    blocking: false,
    allowedOutcomes: ["additionalContext", "diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.Setup,
    redactionHints: [],
  },
  // Session-machine shutdown. Emitted during `gracefulShutdown()` BEFORE
  // `SessionEnd`. Diagnostics-only — blocking / context-mutating hooks
  // here would fight the shutdown sequence.
  Stop: {
    blocking: false,
    allowedOutcomes: ["diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.Stop,
    redactionHints: [],
  },
  // Capability ask-gated permission request. Blocking so the executor
  // awaits a verdict before running the plan.
  //
  // Wire truth (B5 §2.3 override of P4 §8.5): `continue` is allow,
  // `block` is deny. `allow` / `deny` are package-local ergonomic
  // aliases (see `permission.ts::verdictOf()`); they compile down to
  // existing wire fields so nacp-core / hook.outcome stay unchanged.
  //
  // Fail-closed: when the capability executor observes zero registered
  // handlers (handlerCount === 0) it treats the request as denied.
  PermissionRequest: {
    blocking: true,
    allowedOutcomes: ["block", "additionalContext", "diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.PermissionRequest,
    redactionHints: ["tool_input"],
  },
  // Observational — emitted AFTER a permission decision resolves to
  // deny (either a `block` handler outcome or the fail-closed path with
  // no handlers). Non-blocking so the executor can return its
  // `policy-denied` / `policy-ask` error without waiting.
  PermissionDenied: {
    blocking: false,
    allowedOutcomes: ["additionalContext", "diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.PermissionDenied,
    redactionHints: ["tool_input"],
  },

  // ══════════════════════════════════════════════════════════════════
  // §D — Class D (6, new)
  // ══════════════════════════════════════════════════════════════════

  // Early signal that usage is approaching the ARM threshold. Purely
  // observational so the inspector / eval channel can preview compact
  // pressure before the orchestrator actually transitions to `armed`.
  ContextPressure: {
    blocking: false,
    allowedOutcomes: ["additionalContext", "diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.ContextPressure,
    redactionHints: [],
  },
  // Transition: `idle → armed` / `failed → armed` (retry path).
  // Payload per B4 `LifecycleEvent.payload`: `{ usagePct, retry?, retriesUsed? }`.
  ContextCompactArmed: {
    blocking: false,
    allowedOutcomes: ["diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.ContextCompactArmed,
    redactionHints: [],
  },
  // Transition: `armed → preparing`. Background prepare job dispatched.
  // Payload per B4: `{ prepareJobId, snapshotVersion, tokenEstimate }`.
  ContextCompactPrepareStarted: {
    blocking: false,
    allowedOutcomes: ["diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.ContextCompactPrepareStarted,
    redactionHints: [],
  },
  // Transition: `committing → committed → idle`. Async-compact happy path
  // AND `forceSyncCompact` happy path both converge here.
  // Payload per B4: `{ oldVersion, newVersion, summary, reason? }`.
  ContextCompactCommitted: {
    blocking: false,
    allowedOutcomes: ["additionalContext", "diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.ContextCompactCommitted,
    redactionHints: [],
  },
  // Transition: prepare error / commit error / fallback error → `failed`.
  // Payload per B4: `{ reason, retriesUsed, retryBudget, terminal }`.
  ContextCompactFailed: {
    blocking: false,
    allowedOutcomes: ["diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.ContextCompactFailed,
    redactionHints: [],
  },
  // B1 binding-F04 disclosure: eval sink overflow with explicit
  // `droppedCount / capacity` so observability callers can flush to
  // durable storage. **Metadata only in B5.** Real producer lives in
  // `eval-observability` (B6 SessionInspector dedup patch).
  EvalSinkOverflow: {
    blocking: false,
    allowedOutcomes: ["additionalContext", "diagnostics"],
    payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.EvalSinkOverflow,
    redactionHints: [],
  },
} as const;

/** Returns true if the given event blocks the agent loop until handlers complete. */
export function isBlockingEvent(name: HookEventName): boolean {
  return HOOK_EVENT_CATALOG[name].blocking;
}

/**
 * The five async-compact lifecycle event names mirror
 * `@nano-agent/context-management`'s `COMPACT_LIFECYCLE_EVENT_NAMES`.
 *
 * Exported separately so the B4 → B5 bridge adapter can statically
 * check that every event `AsyncCompactOrchestrator` emits is a
 * registered `HookEventName` without importing the whole catalog.
 *
 * NOTE: `ContextPressure` is currently the early-signal event (emitted
 * by the scheduler / policy seam when `shouldArm === true`). The other
 * four are the actual state-machine transitions.
 */
export const ASYNC_COMPACT_HOOK_EVENTS: readonly HookEventName[] = [
  "ContextPressure",
  "ContextCompactArmed",
  "ContextCompactPrepareStarted",
  "ContextCompactCommitted",
  "ContextCompactFailed",
] as const;

/** The four Class B events, grouped for ease of consumer discovery. */
export const CLASS_B_HOOK_EVENTS: readonly HookEventName[] = [
  "Setup",
  "Stop",
  "PermissionRequest",
  "PermissionDenied",
] as const;
