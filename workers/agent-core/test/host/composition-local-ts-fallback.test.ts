/**
 * P2 Phase 4 — D07 binding activation + local-ts fallback testable.
 *
 * Covers (per action-plan §4.5 P4-03 + Q2a):
 *   - env.CAPABILITY_TRANSPORT=local-ts routes capability transport
 *     to the local reference path (not service-binding);
 *   - default (env unset + CAPABILITY_WORKER bound) routes to service-binding;
 *   - local-ts seam is preserved even when CAPABILITY_WORKER is present
 *     (Q2a opt-in semantics).
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_RUNTIME_CONFIG,
  type SessionRuntimeEnv,
  type ServiceBindingLike,
} from "../../src/host/env.js";
import {
  createDefaultCompositionFactory,
  type CapabilityCompositionHandle,
} from "../../src/host/composition.js";

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

describe("D07 binding activation + local-ts fallback (Q2a)", () => {
  it("env unset + CAPABILITY_WORKER bound → service-binding transport is selected (default)", () => {
    const factory = createDefaultCompositionFactory();
    const h = factory.create(
      makeEnv({ CAPABILITY_WORKER: fakeBinding() }),
      DEFAULT_RUNTIME_CONFIG,
    );
    const cap = h.capability as CapabilityCompositionHandle;
    expect(cap.transport).toBe("service-binding");
  });

  it("env.CAPABILITY_TRANSPORT=local-ts → local transport wins even with binding present (Q2a opt-in)", () => {
    const factory = createDefaultCompositionFactory();
    const h = factory.create(
      makeEnv({
        CAPABILITY_WORKER: fakeBinding(),
        CAPABILITY_TRANSPORT: "local-ts",
      } as unknown as Partial<SessionRuntimeEnv>),
      DEFAULT_RUNTIME_CONFIG,
    );
    const cap = h.capability as CapabilityCompositionHandle;
    expect(cap.transport).toBe("local-ts");
    expect(cap.serviceBindingTransport).toBeNull();
  });

  it("no binding + no opt-in → honest-degrade to 'unavailable' (not undefined)", () => {
    const factory = createDefaultCompositionFactory();
    const h = factory.create(makeEnv(), DEFAULT_RUNTIME_CONFIG);
    const cap = h.capability as CapabilityCompositionHandle;
    expect(cap.transport).toBe("unavailable");
    expect(cap.reason).toBeDefined();
  });

  it("env.CAPABILITY_TRANSPORT='service-binding' (explicit) + no binding → unavailable (not an error)", () => {
    const factory = createDefaultCompositionFactory();
    const h = factory.create(
      makeEnv({
        CAPABILITY_TRANSPORT: "service-binding",
      } as unknown as Partial<SessionRuntimeEnv>),
      DEFAULT_RUNTIME_CONFIG,
    );
    const cap = h.capability as CapabilityCompositionHandle;
    // Explicit "service-binding" without a binding is an unavailable
    // case — the factory falls through to the no-binding branch.
    expect(cap.transport).toBe("unavailable");
  });
});
