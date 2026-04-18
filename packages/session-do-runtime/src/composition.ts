/**
 * Composition Contract — what subsystems the Session DO assembles.
 *
 * The Session DO is a runtime assembly layer, not a monolith. It composes
 * subsystem handles via a `CompositionFactory`, which is the single seam
 * that prevents the DO class from directly importing subsystem internals.
 *
 * Phase 4 (A5) note: the factory now honours a `CompositionProfile` so
 * the same assembly host can run all-local (default) or promote any of
 * the three v1 seams — `capability / hooks / provider` — to a
 * service-binding delegate without changing the DO class. The default
 * factory still returns no-op handles so the DO remains usable
 * standalone in tests; deployed builds inject a profile-aware factory.
 *
 * All handles are typed as `unknown` at this layer — the DO interacts
 * with subsystems through their own typed interfaces, not through this
 * struct. The factory accepts the runtime env + config and returns a
 * fully-assembled `SubsystemHandles` bag.
 */

import type { CompositionProfile, SessionRuntimeEnv, RuntimeConfig } from "./env.js";
import {
  DEFAULT_COMPOSITION_PROFILE,
  readCompositionProfile,
} from "./env.js";

// ── Subsystem Handles ──

/**
 * All subsystem handles available to the Session DO after composition.
 *
 *   kernel     — agent-runtime-kernel step loop driver
 *                (may also expose `pushStreamEvent` for session streaming)
 *   llm        — LLM wrapper / provider abstraction
 *   capability — capability runtime (tool execution)
 *   workspace  — workspace context & artifact management
 *   hooks      — hooks dispatcher (pre/post/guard) with `emit(event, …)`
 *   eval       — eval-observability trace sink with `emit(event)`
 *   storage    — storage-topology helpers for placement-aware I/O
 *   profile    — the active composition profile (set by the factory)
 */
export interface SubsystemHandles {
  readonly kernel: unknown;
  readonly llm: unknown;
  readonly capability: unknown;
  readonly workspace: unknown;
  readonly hooks: unknown;
  readonly eval: unknown;
  readonly storage: unknown;
  readonly profile: CompositionProfile;
}

// ── Composition Factory ──

export interface CompositionFactory {
  create(env: SessionRuntimeEnv, config: RuntimeConfig): SubsystemHandles;
}

/**
 * Compute the effective composition profile:
 *   1. explicit `config.compositionProfile` wins,
 *   2. otherwise read from `env` (presence → remote, absence → local),
 *   3. finally fall back to `DEFAULT_COMPOSITION_PROFILE`.
 *
 * The default factory publishes the resolved profile on `handles.profile`
 * so downstream composition layers can inspect what was chosen without
 * re-running the resolution logic.
 */
export function resolveCompositionProfile(
  env: SessionRuntimeEnv,
  config: RuntimeConfig,
): CompositionProfile {
  if (config.compositionProfile) return config.compositionProfile;
  const envProfile = readCompositionProfile(env);
  return {
    capability: envProfile.capability ?? DEFAULT_COMPOSITION_PROFILE.capability,
    hooks: envProfile.hooks ?? DEFAULT_COMPOSITION_PROFILE.hooks,
    provider: envProfile.provider ?? DEFAULT_COMPOSITION_PROFILE.provider,
  };
}

/**
 * Default composition factory — produces an otherwise-empty handle bag
 * but carries the resolved profile so downstream wiring (eval sink,
 * remote seams) can branch on it without re-reading env. Deployed
 * builds should supply a richer factory that wires concrete subsystem
 * packages; see `makeRemoteBindingsComposition()` for the hook/capability/
 * fake-provider wiring pattern.
 */
export function createDefaultCompositionFactory(): CompositionFactory {
  return {
    create(env: SessionRuntimeEnv, config: RuntimeConfig): SubsystemHandles {
      const profile = resolveCompositionProfile(env, config);
      return {
        kernel: undefined,
        llm: undefined,
        capability: undefined,
        workspace: undefined,
        hooks: undefined,
        eval: undefined,
        storage: undefined,
        profile,
      };
    },
  };
}
