/**
 * Composition Contract — what subsystems the Session DO assembles.
 *
 * The Session DO is a runtime assembly layer, not a monolith. It composes
 * subsystem handles via a `CompositionFactory`, which is the single seam
 * that prevents the DO class from directly importing subsystem internals.
 *
 * All handles are typed as `unknown` at this layer — the DO interacts
 * with subsystems through their own typed interfaces, not through this
 * struct. The factory accepts the runtime env + config and returns a
 * fully-assembled `SubsystemHandles` bag.
 *
 * Reference: docs/action-plan/session-do-runtime.md Phase 1 (P1-01 to P1-03)
 */

import type { SessionRuntimeEnv, RuntimeConfig } from "./env.js";

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
 */
export interface SubsystemHandles {
  readonly kernel: unknown;
  readonly llm: unknown;
  readonly capability: unknown;
  readonly workspace: unknown;
  readonly hooks: unknown;
  readonly eval: unknown;
  readonly storage: unknown;
}

// ── Composition Factory ──

/**
 * Factory that wires up subsystem handles from the runtime environment.
 *
 * Implementations provide the actual kernel / llm / capability / … handles.
 * The DO calls `create()` once during initialization.
 */
export interface CompositionFactory {
  create(env: SessionRuntimeEnv, config: RuntimeConfig): SubsystemHandles;
}

/**
 * Default composition factory used when no factory is injected.
 *
 * Returns a `SubsystemHandles` bag filled with no-op stubs so the DO
 * class is usable standalone (tests + vitest). Deployed builds SHOULD
 * supply a real factory that wires real subsystem packages.
 */
export function createDefaultCompositionFactory(): CompositionFactory {
  return {
    create(_env: SessionRuntimeEnv, _config: RuntimeConfig): SubsystemHandles {
      return {
        kernel: undefined,
        llm: undefined,
        capability: undefined,
        workspace: undefined,
        hooks: undefined,
        eval: undefined,
        storage: undefined,
      };
    },
  };
}
