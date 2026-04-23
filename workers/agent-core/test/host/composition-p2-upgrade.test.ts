/**
 * P2 Phase 2 — D06 composition factory upgrade tests.
 *
 * Covers (per action-plan §4.3 P2-01 ~ P2-06 + GPT R1):
 *   - 6 handles non-undefined (kernel / llm / capability / workspace / hooks / eval)
 *   - workspace.assembler is a real ContextAssembler instance
 *   - capability transport selection (default service-binding / opt-in local-ts)
 *   - capability honest-degrade when no binding + no opt-in
 *   - makeRemoteBindingsFactory returns null for 4 always-host-local slots
 *   - SubsystemHandles shape stays 8 slots (R1: no top-level assembler added)
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_RUNTIME_CONFIG,
  type SessionRuntimeEnv,
  type ServiceBindingLike,
} from "../../src/host/env.js";
import {
  createDefaultCompositionFactory,
  type SubsystemHandles,
  type WorkspaceCompositionHandle,
  type CapabilityCompositionHandle,
} from "../../src/host/composition.js";
import { makeRemoteBindingsFactory } from "../../src/host/remote-bindings.js";

function makeEnv(overrides: Partial<SessionRuntimeEnv> = {}): SessionRuntimeEnv {
  return {
    SESSION_DO: {},
    R2_ARTIFACTS: {},
    KV_CONFIG: {},
    ...overrides,
  };
}

function fakeBinding(): ServiceBindingLike {
  return {
    fetch: async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  };
}

describe("P2 Phase 2 — createDefaultCompositionFactory upgrade", () => {
  it("produces 6 non-undefined subsystem handles (kernel / llm / capability / workspace / hooks / eval)", () => {
    const factory = createDefaultCompositionFactory();
    const h = factory.create(makeEnv(), DEFAULT_RUNTIME_CONFIG);
    expect(h.kernel).not.toBeUndefined();
    expect(h.llm).not.toBeUndefined();
    expect(h.capability).not.toBeUndefined();
    expect(h.workspace).not.toBeUndefined();
    expect(h.hooks).not.toBeUndefined();
    expect(h.eval).not.toBeUndefined();
  });

  it("workspace.assembler is a real ContextAssembler with 6-layer canonical allowlist", () => {
    const factory = createDefaultCompositionFactory();
    const h = factory.create(makeEnv(), DEFAULT_RUNTIME_CONFIG);
    const ws = h.workspace as WorkspaceCompositionHandle;
    // Should be able to call assemble() and get back an AssemblyResult-shaped object
    const result = ws.assembler.assemble([
      {
        kind: "session",
        priority: 0,
        content: "hello",
        tokenEstimate: 2,
        required: false,
      },
    ]);
    expect(Array.isArray(result.assembled)).toBe(true);
    expect(result.totalTokens).toBeGreaterThan(0);
  });
});

describe("P2 Phase 2 — capability transport selection (Q2a)", () => {
  it("default: service-binding when env.BASH_CORE present", () => {
    const factory = createDefaultCompositionFactory();
    const h = factory.create(
      makeEnv({ BASH_CORE: fakeBinding() }),
      DEFAULT_RUNTIME_CONFIG,
    );
    const cap = h.capability as CapabilityCompositionHandle;
    expect(cap.transport).toBe("service-binding");
    expect(cap.serviceBindingTransport).not.toBeNull();
  });

  it("opt-in: local-ts when env.CAPABILITY_TRANSPORT=local-ts (even if BASH_CORE is present)", () => {
    const factory = createDefaultCompositionFactory();
    const h = factory.create(
      makeEnv({
        BASH_CORE: fakeBinding(),
        CAPABILITY_TRANSPORT: "local-ts",
      } as unknown as Partial<SessionRuntimeEnv>),
      DEFAULT_RUNTIME_CONFIG,
    );
    const cap = h.capability as CapabilityCompositionHandle;
    expect(cap.transport).toBe("local-ts");
    expect(cap.serviceBindingTransport).toBeNull();
    expect(cap.reason).toContain("local-ts");
  });

  it("honest-degrade: unavailable when no binding + no opt-in", () => {
    const factory = createDefaultCompositionFactory();
    const h = factory.create(makeEnv(), DEFAULT_RUNTIME_CONFIG);
    const cap = h.capability as CapabilityCompositionHandle;
    expect(cap.transport).toBe("unavailable");
    expect(cap.serviceBindingTransport).toBeNull();
    expect(cap.reason).toContain("unavailable");
  });

  it("legacy alias: service-binding still works when only env.CAPABILITY_WORKER is present", () => {
    const factory = createDefaultCompositionFactory();
    const h = factory.create(
      makeEnv({ CAPABILITY_WORKER: fakeBinding() }),
      DEFAULT_RUNTIME_CONFIG,
    );
    const cap = h.capability as CapabilityCompositionHandle;
    expect(cap.transport).toBe("service-binding");
  });
});

describe("P2 Phase 2 — makeRemoteBindingsFactory 4-nullable documented", () => {
  it("returns explicit null (not undefined) for kernel / workspace / eval / storage with reason comments in source", () => {
    const factory = makeRemoteBindingsFactory();
      const h = factory.create(
      makeEnv({ BASH_CORE: fakeBinding() }),
      DEFAULT_RUNTIME_CONFIG,
    );
    // The 4 always-host-local slots are explicitly nulled at this
    // layer. Default factory fills them with host-local handles — this
    // factory is designed to be merged on top.
    expect(h.kernel).toBeNull();
    expect(h.workspace).toBeNull();
    expect(h.eval).toBeNull();
    expect(h.storage).toBeNull();
  });
});

describe("P2 Phase 2 — SubsystemHandles shape (R1: no top-level assembler)", () => {
  it("handle bag has exactly 8 keys: kernel/llm/capability/workspace/hooks/eval/storage/profile", () => {
    const factory = createDefaultCompositionFactory();
    const h = factory.create(makeEnv(), DEFAULT_RUNTIME_CONFIG);
    const keys = Object.keys(h as Record<string, unknown>).sort();
    expect(keys).toEqual(
      [
        "capability",
        "eval",
        "hooks",
        "kernel",
        "llm",
        "profile",
        "storage",
        "workspace",
      ].sort(),
    );
    // R1 enforcement: no top-level `assembler`
    expect((h as unknown as Record<string, unknown>)["assembler"]).toBeUndefined();
  });
});
