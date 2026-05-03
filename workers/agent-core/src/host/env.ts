/**
 * Runtime Environment Types — what bindings and configuration a Session DO expects.
 *
 * SessionRuntimeEnv describes the Cloudflare Worker environment bindings
 * that the Session DO needs at runtime. RuntimeConfig holds tunable
 * operational parameters with sensible defaults.
 *
 * Phase 4 (A5) binding catalog (AX-QNA Q9):
 *   The v1 external binding catalog freezes THREE remote worker slots:
 *     - BASH_CORE             — remote tool execution (capability-runtime)
 *     - HOOK_WORKER           — remote hook dispatch    (hooks)
 *     - FAKE_PROVIDER_WORKER  — remote fake LLM seam    (llm-wrapper / P5 golden path)
 *   These are the only remote seams composed into v1. SKILL_WORKERS is
 *   retained as a RESERVED slot only — it must not be composed into the
 *   runtime truth in Phase 4.
 *   `CAPABILITY_WORKER` is kept only as a legacy alias during the
 *   worker-matrix closeout so pre-existing tests and fixtures do not
 *   silently lose the capability seam.
 *
 * Reference: `docs/action-plan/after-skeleton/A5-external-seam-closure.md`
 * Reference code: `packages/nacp-core/src/transport/service-binding.ts`
 */

// ── Service binding shape ───────────────────────────────────────────

/**
 * Cloudflare-style service-binding shape. Kept structural so this
 * package does not take a hard type-dep on `@cloudflare/workers-types`.
 * The concrete runtime supplies either a `fetch`-capable binding
 * (HTTP-flavoured) or an RPC binding with `handleNacp` — or both.
 */
export interface ServiceBindingLike {
  readonly fetch?: (request: Request) => Promise<Response>;
  readonly handleNacp?: (envelope: unknown) => Promise<unknown>;
}

// ── Session Runtime Environment ──

/**
 * Typed environment bindings that a Session DO Worker expects.
 *
 * Required bindings:
 *   SESSION_DO  — Durable Object namespace for session actors
 *   R2_ARTIFACTS — R2 bucket for cold storage (archives, attachments, large files)
 *   KV_CONFIG   — KV namespace for warm config (provider config, model registry, etc.)
 *
 * Optional v1 binding catalog (P4):
 *   BASH_CORE             — Service binding to the capability-runtime worker.
 *   HOOK_WORKER           — Service binding to the hook-runtime worker.
 *   FAKE_PROVIDER_WORKER  — Service binding to the fake LLM provider worker.
 *
 * Reserved (NOT part of v1 binding catalog, AX-QNA Q9):
 *   SKILL_WORKERS         — Reserved seam for future skill composition.
 *                           MUST NOT be read by Phase 4 composition code.
 *   LLM_API_KEY           — Optional API key for real-provider smoke (P5 only).
 *   ENVIRONMENT           — Deployment environment identifier.
 */
export interface SessionRuntimeEnv {
  readonly SESSION_DO: unknown;
  readonly R2_ARTIFACTS?: unknown;
  readonly KV_CONFIG?: unknown;
  readonly NANO_AGENT_DB?: D1Database;
  readonly AI?: {
    run(model: string, input: Record<string, unknown>): Promise<unknown>;
  };
  readonly NANO_AGENT_LLM_CALL_LIMIT?: string;
  readonly NANO_AGENT_TOOL_CALL_LIMIT?: string;
  readonly NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED?: string;
  readonly NANO_INTERNAL_BINDING_SECRET?: string;
  readonly TEAM_UUID?: string;

  // v1 binding catalog (Phase 4 truth)
  readonly BASH_CORE?: ServiceBindingLike;
  readonly HOOK_WORKER?: ServiceBindingLike;
  readonly FAKE_PROVIDER_WORKER?: ServiceBindingLike;
  /**
   * RH1 P1-06a — orchestrator-core service binding.
   * NanoSessionDO uses `forwardServerFrameToClient(sessionUuid, frame, meta)`
   * RPC to push server frames to the client attached to orchestrator-core's
   * User DO (cross-worker WS push topology). agent-core never binds
   * `ORCHESTRATOR_USER_DO` directly because that DO namespace lives in
   * orchestrator-core's wrangler.
   */
  readonly ORCHESTRATOR_CORE?: ServiceBindingLike & {
    forwardServerFrameToClient?(
      sessionUuid: string,
      frame: { readonly kind: string; readonly [k: string]: unknown },
      meta: { readonly userUuid: string; readonly teamUuid?: string; readonly traceUuid?: string },
    ): Promise<{ ok: boolean; delivered: boolean; reason?: string }>;
    recordAuditEvent?(record: {
      readonly ts: string;
      readonly worker: string;
      readonly trace_uuid?: string;
      readonly session_uuid?: string;
      readonly team_uuid?: string;
      readonly user_uuid?: string;
      readonly device_uuid?: string;
      readonly event_kind: string;
      readonly ref?: { readonly kind: string; readonly uuid: string };
      readonly detail?: Record<string, unknown>;
      readonly outcome: "ok" | "denied" | "failed";
    }): Promise<{ ok: boolean }>;
    recordToolCall?(input: {
      readonly request_uuid: string;
      readonly session_uuid: string;
      readonly team_uuid: string;
      readonly turn_uuid?: string | null;
      readonly tool_name: string;
      readonly input?: Record<string, unknown>;
      readonly output?: Record<string, unknown> | null;
      readonly status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
      readonly cancel_initiator?: "user" | "system" | "tool" | null;
    }, meta?: { readonly trace_uuid?: string; readonly team_uuid?: string }): Promise<{ ok: boolean }>;
    authorizeToolUse?(input: {
      readonly session_uuid: string;
      readonly team_uuid: string;
      readonly tool_name: string;
      readonly tool_input?: Record<string, unknown>;
    }, meta?: { readonly trace_uuid?: string; readonly team_uuid?: string }): Promise<{
      readonly ok: boolean;
      readonly decision: "allow" | "deny" | "ask";
      readonly source: "session-rule" | "tenant-rule" | "approval-policy" | "unavailable";
      readonly reason?: string;
    }>;
    settleConfirmation?(input: {
      readonly session_uuid: string;
      readonly confirmation_uuid: string;
      readonly status: "timeout" | "superseded";
      readonly decision_payload?: Record<string, unknown> | null;
    }, meta?: { readonly trace_uuid?: string; readonly team_uuid?: string }): Promise<{
      readonly ok: boolean;
      readonly status?: string;
      readonly reason?: string;
    }>;
    /**
     * HPX5 F3 — context durable state probe used by auto-compact
     * decision. agent-core composes the result with `composeCompactSignalProbe`
     * (`workers/agent-core/src/host/compact-breaker.ts`) to fire the
     * scheduler's `compact` decision at turn boundaries.
     */
    readContextDurableState?(
      sessionUuid: string,
      teamUuid: string,
      meta: { readonly trace_uuid: string; readonly team_uuid: string },
    ): Promise<{
      readonly model?: {
        readonly auto_compact_token_limit?: number | null;
        readonly effective_context_pct?: number | null;
        readonly context_window?: number | null;
      } | null;
      readonly usage?: {
        readonly llm_input_tokens?: number | null;
        readonly llm_output_tokens?: number | null;
      } | null;
      readonly [k: string]: unknown;
    } | null>;
    /**
     * HPX5 F2b — WriteTodos capability backend. Called when LLM emits
     * `tool_use { name: "write_todos" }`. Honors HP6 Q19 at-most-1
     * in_progress invariant; auto-closes prior in_progress todos.
     */
    writeTodos?(input: {
      readonly session_uuid: string;
      readonly conversation_uuid: string;
      readonly team_uuid: string;
      readonly user_uuid: string;
      readonly trace_uuid: string;
      readonly todos: ReadonlyArray<{
        readonly content: string;
        readonly status?: "pending" | "in_progress" | "completed" | "cancelled" | "blocked";
        readonly parent_todo_uuid?: string | null;
      }>;
    }): Promise<
      | {
          readonly ok: true;
          readonly created: ReadonlyArray<{
            readonly todo_uuid: string;
            readonly status: "pending" | "in_progress" | "completed" | "cancelled" | "blocked";
          }>;
          readonly auto_closed: ReadonlyArray<{ readonly todo_uuid: string }>;
        }
      | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
    >;
  };
  readonly FILESYSTEM_CORE?: ServiceBindingLike & {
    readArtifact?(
      input: {
        readonly team_uuid: string;
        readonly session_uuid: string;
        readonly file_uuid: string;
      },
      meta?: { readonly trace_uuid?: string; readonly team_uuid?: string },
    ): Promise<{
      readonly file: { readonly mime?: string | null };
      readonly bytes: ArrayBuffer;
    } | null>;
  };

  // Reserved / legacy
  /** @deprecated Legacy alias for `BASH_CORE`. Prefer `BASH_CORE` in new code and bindings. */
  readonly CAPABILITY_WORKER?: ServiceBindingLike;
  /** @deprecated Reserved for a future skill composition seam. Do not consume. */
  readonly SKILL_WORKERS?: unknown;
  readonly LLM_API_KEY?: string;
  readonly ENVIRONMENT?: string;
}

/** Enumerable list of v1 binding names. Kept in sync with the type above. */
export const V1_BINDING_CATALOG: readonly (keyof SessionRuntimeEnv)[] = [
  "BASH_CORE",
  "HOOK_WORKER",
  "FAKE_PROVIDER_WORKER",
] as const;

/** Reserved bindings that MUST NOT be composed in Phase 4. */
export const RESERVED_BINDINGS: readonly (keyof SessionRuntimeEnv)[] = [
  "SKILL_WORKERS",
] as const;

// ── Composition Profile ──

/**
 * Per-seam switch between the local reference path and a remote
 * service-binding delegate. Phase 4 defaults to `local` everywhere —
 * deployments that have wired real bindings toggle specific seams to
 * `remote`. `fake-provider-worker` is the only way to route provider
 * calls to a remote worker; absence falls back to local-fetch.
 */
export type CompositionMode = "local" | "remote";

export interface CompositionProfile {
  readonly capability: CompositionMode;
  readonly hooks: CompositionMode;
  readonly provider: CompositionMode;
}

/** Default profile — all seams local. P4 handoff pack overrides this. */
export const DEFAULT_COMPOSITION_PROFILE: CompositionProfile = {
  capability: "local",
  hooks: "local",
  provider: "local",
} as const;

export function resolveCapabilityBinding(
  env: Pick<SessionRuntimeEnv, "BASH_CORE" | "CAPABILITY_WORKER">,
): ServiceBindingLike | undefined {
  return env.BASH_CORE ?? env.CAPABILITY_WORKER;
}

/**
 * Read a `CompositionProfile` from the runtime env. Any seam whose
 * corresponding binding is missing falls back to `local`; any seam
 * whose binding is present defaults to `remote`.
 */
export function readCompositionProfile(
  env: SessionRuntimeEnv,
): CompositionProfile {
  return {
    capability: resolveCapabilityBinding(env) ? "remote" : "local",
    hooks: env.HOOK_WORKER ? "remote" : "local",
    provider: env.FAKE_PROVIDER_WORKER ? "remote" : "local",
  };
}

// ── Runtime Config ──

/**
 * Tunable operational parameters for the Session DO runtime.
 * All timeouts are in milliseconds.
 */
export interface RuntimeConfig {
  readonly heartbeatIntervalMs: number;
  readonly ackTimeoutMs: number;
  readonly maxTurnSteps: number;
  readonly checkpointOnTurnEnd: boolean;
  readonly httpFallbackEnabled: boolean;
  /**
   * Override per-seam composition. If absent, the factory reads it
   * from the env via `readCompositionProfile()`.
   */
  readonly compositionProfile?: CompositionProfile;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  heartbeatIntervalMs: 30_000,
  ackTimeoutMs: 10_000,
  maxTurnSteps: 50,
  checkpointOnTurnEnd: true,
  httpFallbackEnabled: true,
};
