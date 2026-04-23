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
  resolveCapabilityBinding,
} from "./env.js";
import {
  InMemoryArtifactStore,
  MountRouter,
  WorkspaceNamespace,
} from "@nano-agent/workspace-context-artifacts";
import { BoundedEvalSink, extractMessageUuid } from "./eval-sink.js";
import {
  composeWorkspaceWithEvidence,
  type WorkspaceCompositionHandle,
} from "./workspace-runtime.js";

// ─────────────────────────────────────────────────────────────────────
// Subsystem handle shapes (P2 Phase 2 live default)
// ─────────────────────────────────────────────────────────────────────

// NOTE: `WorkspaceCompositionHandle` lives in `workspace-runtime.ts`
// and includes `{assembler, compactManager, snapshotBuilder,
// captureSnapshot}`. We re-export it here for convenience so
// consumers that import from `./composition.js` still see the type.
export { type WorkspaceCompositionHandle } from "./workspace-runtime.js";

/** Minimal capability handle — serviceBindingTransport when remote, null fallback when unavailable. */
export interface CapabilityCompositionHandle {
  readonly serviceBindingTransport: unknown | null;
  readonly transport: "service-binding" | "local-ts" | "unavailable";
  readonly reason?: string;
}

/**
 * Eval composition handle — exposes a record-shaped `emit(record)` that
 * internally adapts to the underlying `BoundedEvalSink.emit({record,
 * messageUuid})` contract. The raw `sink` is also exposed so the DO can
 * adopt it as its own `defaultEvalSink` (and `getRecords / getDisclosure /
 * getStats` all read from the same instance).
 */
export interface EvalCompositionHandle {
  emit(record: unknown): void;
  readonly sink: BoundedEvalSink;
}

/** Kernel / llm / hooks / storage are honest-degrade placeholders until wired. */
export interface KernelCompositionHandle {
  readonly phase: "P2-stub" | "live";
  readonly reason: string;
}
export interface LlmCompositionHandle {
  readonly phase: "P2-stub" | "live";
  readonly reason: string;
}
export interface HooksCompositionHandle {
  readonly phase: "P2-stub" | "live";
  readonly reason: string;
}
export interface StorageCompositionHandle {
  readonly phase: "P2-stub" | "host-local";
  readonly reason: string;
}

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
 * Default composition factory (P2 Phase 2 upgrade).
 *
 * Per charter §6.2 P2 DoD #2-4 + P1-P5 GPT review R1:
 *   - Returns 6 non-undefined handles (kernel / llm / capability /
 *     workspace / hooks / eval) so the turn loop subsystems can be
 *     consumed without null-check gymnastics by D05 consumer / kernel.
 *   - `workspace.assembler` is a **real** `ContextAssembler` instance —
 *     this is the load-bearing one consumed via
 *     `this.composition?.workspace?.assembler` by the D05 host consumer
 *     (per R1, NOT a top-level `assembler` handle).
 *   - `eval` is a real `BoundedEvalSink` preserving B7 LIVE dedup +
 *     overflow disclosure contract.
 *   - `storage` is an explicit `host-local` marker (per Q4a host-local
 *     continues; tenant wrapper lives in the DO itself, not here).
 *   - `capability` reads `env.CAPABILITY_TRANSPORT` to select transport:
 *     default = `service-binding` (consumes canonical `env.BASH_CORE`,
 *     with legacy `env.CAPABILITY_WORKER` still accepted during closeout);
 *     opt-in `local-ts` forces the local reference path (dev / unit
 *     test / failure fallback, per Q2a).
 *   - `kernel` / `llm` / `hooks` remain honest `P2-stub` placeholders
 *     (non-undefined) — full live wiring belongs to post-P2 charters;
 *     D05 consumer does not require them to be live in P2.
 *
 * Deployed builds may supply a richer factory (see
 * `makeRemoteBindingsFactory()`) that layers real remote transports on
 * top; this default factory guarantees the minimal live handle bag
 * needed for `initial_context` consumption to work today.
 */
export function createDefaultCompositionFactory(): CompositionFactory {
  return {
    create(env: SessionRuntimeEnv, config: RuntimeConfig): SubsystemHandles {
      const profile = resolveCompositionProfile(env, config);

      // Workspace — the full `WorkspaceCompositionHandle` (assembler +
      // compactManager + snapshotBuilder + captureSnapshot) so the DO
      // can use it directly without running its own fallback builder.
      // Evidence sink wiring is left to the DO: the DO routes it via
      // `effectiveEvalSink.emit` after the default factory returns.
      const mountRouter = new MountRouter();
      const namespace = new WorkspaceNamespace(mountRouter);
      const artifactStore = new InMemoryArtifactStore();
      const workspace: WorkspaceCompositionHandle = composeWorkspaceWithEvidence(
        {
          namespace,
          artifactStore,
          // evidenceSink / evidenceAnchor omitted — DO wires them
          // post-hoc via `setEvidenceWiring` if needed; tests that
          // don't need live evidence still get the handle shape.
        },
      );

      // Eval — real BoundedEvalSink wrapped into an `emit(record)` adapter
      // so consumers (including the DO) see a uniform record-shaped
      // emit surface; the raw sink is also exposed on `.sink` so the
      // DO can adopt it as its `defaultEvalSink`.
      const evalSinkInstance = new BoundedEvalSink({ capacity: 1024 });
      const evalHandle: EvalCompositionHandle = {
        emit(record: unknown): void {
          evalSinkInstance.emit({
            record,
            messageUuid: extractMessageUuid(record),
          });
        },
        sink: evalSinkInstance,
      };

      // Capability transport selection (Q2a: default remote, opt-in local-ts).
      const envRecord = env as unknown as Record<string, unknown>;
      const transportEnv = envRecord["CAPABILITY_TRANSPORT"] as
        | string
        | undefined;
      const capabilityBinding = resolveCapabilityBinding(env);
      let capability: CapabilityCompositionHandle;
      if (transportEnv === "local-ts") {
        capability = {
          serviceBindingTransport: null,
          transport: "local-ts",
          reason:
            "env.CAPABILITY_TRANSPORT=local-ts forces local reference path (Q2a opt-in; dev / unit test / failure fallback).",
        };
      } else if (capabilityBinding) {
        capability = {
          serviceBindingTransport: capabilityBinding,
          transport: "service-binding",
          reason:
            "default: bound to env.BASH_CORE via service binding (legacy env.CAPABILITY_WORKER still accepted during closeout; Q2a default).",
        };
      } else {
        capability = {
          serviceBindingTransport: null,
          transport: "unavailable",
          reason:
            "no env.BASH_CORE binding (or legacy env.CAPABILITY_WORKER alias) and no opt-in CAPABILITY_TRANSPORT override; honest-degrade — tool.call will surface unavailable.",
        };
      }

      const kernel: KernelCompositionHandle = {
        phase: "P2-stub",
        reason:
          "kernel runner is host-local; no default compact delegate is auto-wired in first-wave composition, and later live delegate injection belongs to a later charter — composition provides a non-undefined sentinel so D05 consumer + downstream null-checks succeed.",
      };
      const llm: LlmCompositionHandle = {
        phase: "P2-stub",
        reason:
          "llm executor is host-local; live wiring (adapter + registry + anchor provider) belongs to a later charter.",
      };
      const hooks: HooksCompositionHandle = {
        phase: "P2-stub",
        reason:
          "hooks dispatcher is host-local; live wiring (registry + local-ts runtime) belongs to a later charter.",
      };
      const storage: StorageCompositionHandle = {
        phase: "host-local",
        reason:
          "Q4a: storage-topology host-local continues. Tenant wrapper (getTenantScopedStorage) lives on the DO itself, not on the composition handle.",
      };

      return {
        kernel,
        llm,
        capability,
        workspace,
        hooks,
        eval: evalHandle,
        storage,
        profile,
      };
    },
  };
}
