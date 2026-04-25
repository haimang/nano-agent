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
  readonly R2_ARTIFACTS: unknown;
  readonly KV_CONFIG: unknown;
  readonly NANO_AGENT_DB?: D1Database;
  readonly AI?: {
    run(model: string, input: Record<string, unknown>): Promise<unknown>;
  };
  readonly NANO_AGENT_LLM_CALL_LIMIT?: string;
  readonly NANO_AGENT_TOOL_CALL_LIMIT?: string;

  // v1 binding catalog (Phase 4 truth)
  readonly BASH_CORE?: ServiceBindingLike;
  readonly HOOK_WORKER?: ServiceBindingLike;
  readonly FAKE_PROVIDER_WORKER?: ServiceBindingLike;

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
