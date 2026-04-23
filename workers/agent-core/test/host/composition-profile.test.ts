/**
 * A5 Phase 1 — Binding catalog + composition profile tests.
 *
 * Locks the three invariants the Session DO composition must obey once
 * external seams exist:
 *   1. `V1_BINDING_CATALOG` enumerates exactly `CAPABILITY_WORKER /
 *      HOOK_WORKER / FAKE_PROVIDER_WORKER`.
 *   2. `SKILL_WORKERS` is reserved — it never drives a profile flip.
 *   3. `resolveCompositionProfile()` honours explicit config first,
 *      env-based presence second, defaults last.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_COMPOSITION_PROFILE,
  DEFAULT_RUNTIME_CONFIG,
  RESERVED_BINDINGS,
  V1_BINDING_CATALOG,
  readCompositionProfile,
  type SessionRuntimeEnv,
} from "../../src/host/env.js";
import {
  createDefaultCompositionFactory,
  resolveCompositionProfile,
} from "../../src/host/composition.js";

function makeEnv(overrides: Partial<SessionRuntimeEnv> = {}): SessionRuntimeEnv {
  return {
    SESSION_DO: {},
    R2_ARTIFACTS: {},
    KV_CONFIG: {},
    ...overrides,
  };
}

describe("V1 binding catalog (AX-QNA Q9)", () => {
  it("lists exactly the three v1 slots in order", () => {
    expect([...V1_BINDING_CATALOG]).toEqual([
      "CAPABILITY_WORKER",
      "HOOK_WORKER",
      "FAKE_PROVIDER_WORKER",
    ]);
  });

  it("lists SKILL_WORKERS as reserved and NOT in the v1 catalog", () => {
    expect([...RESERVED_BINDINGS]).toContain("SKILL_WORKERS");
    expect([...V1_BINDING_CATALOG]).not.toContain("SKILL_WORKERS");
  });
});

describe("readCompositionProfile", () => {
  it("returns all-local when no bindings are present", () => {
    expect(readCompositionProfile(makeEnv())).toEqual(
      DEFAULT_COMPOSITION_PROFILE,
    );
  });

  it("flips each seam to remote when its binding is present", () => {
    const profile = readCompositionProfile(
      makeEnv({
        CAPABILITY_WORKER: { fetch: async () => new Response() },
        HOOK_WORKER: { fetch: async () => new Response() },
        FAKE_PROVIDER_WORKER: { fetch: async () => new Response() },
      }),
    );
    expect(profile).toEqual({
      capability: "remote",
      hooks: "remote",
      provider: "remote",
    });
  });

  it("does NOT flip any seam when only SKILL_WORKERS is set (reserved)", () => {
    const profile = readCompositionProfile(
      makeEnv({ SKILL_WORKERS: { whatever: true } }),
    );
    expect(profile).toEqual(DEFAULT_COMPOSITION_PROFILE);
  });
});

describe("resolveCompositionProfile", () => {
  it("defaults to all-local when config does not override and env has no bindings", () => {
    const profile = resolveCompositionProfile(makeEnv(), DEFAULT_RUNTIME_CONFIG);
    expect(profile).toEqual(DEFAULT_COMPOSITION_PROFILE);
  });

  it("config.compositionProfile takes priority over env signals", () => {
    const profile = resolveCompositionProfile(
      makeEnv({
        CAPABILITY_WORKER: { fetch: async () => new Response() },
      }),
      {
        ...DEFAULT_RUNTIME_CONFIG,
        compositionProfile: {
          capability: "local",
          hooks: "local",
          provider: "local",
        },
      },
    );
    // Capability binding is present but config pins every seam to local.
    expect(profile.capability).toBe("local");
  });

  it("env binding presence flips the seam when no config override is provided", () => {
    const profile = resolveCompositionProfile(
      makeEnv({
        HOOK_WORKER: { fetch: async () => new Response() },
      }),
      DEFAULT_RUNTIME_CONFIG,
    );
    expect(profile.hooks).toBe("remote");
    expect(profile.capability).toBe("local");
    expect(profile.provider).toBe("local");
  });
});

describe("createDefaultCompositionFactory", () => {
  it("publishes the resolved profile on SubsystemHandles.profile", () => {
    const factory = createDefaultCompositionFactory();
    const handles = factory.create(
      makeEnv({ HOOK_WORKER: { fetch: async () => new Response() } }),
      DEFAULT_RUNTIME_CONFIG,
    );
    expect(handles.profile.hooks).toBe("remote");
    expect(handles.profile.capability).toBe("local");
    expect(handles.profile.provider).toBe("local");
  });

  it("returns undefined subsystem handles (no-op default)", () => {
    const factory = createDefaultCompositionFactory();
    const handles = factory.create(makeEnv(), DEFAULT_RUNTIME_CONFIG);
    expect(handles.kernel).toBeUndefined();
    expect(handles.llm).toBeUndefined();
    expect(handles.hooks).toBeUndefined();
  });
});
