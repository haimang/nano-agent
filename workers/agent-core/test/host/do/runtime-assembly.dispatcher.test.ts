// HP5 P2-02 — runtime assembly always injects a HookDispatcher.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.6 HP5
//   * docs/design/hero-to-pro/HP5-confirmation-control-plane.md §7 F2
//   * workers/agent-core/src/hooks/dispatcher.ts

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RUNTIME_CONFIG } from "../../../src/host/env.js";
import { createSessionDoRuntimeAssembly } from "../../../src/host/do/session-do/runtime-assembly.js";
import { HookDispatcher } from "../../../src/hooks/dispatcher.js";

const baseCtx = () => ({
  env: {},
  config: DEFAULT_RUNTIME_CONFIG,
  compositionFactory: {
    create() {
      return {
        kernel: { phase: "P2-stub", reason: "test" },
        llm: { phase: "P2-stub", reason: "test" },
        capability: {
          serviceBindingTransport: null,
          transport: "unavailable" as const,
          reason: "test",
        },
        workspace: null,
        hooks: { emit: async () => ({ ok: true }) },
        eval: { emit: vi.fn() },
        storage: { phase: "host-local", reason: "test" },
        profile: {
          capability: "local" as const,
          hooks: "local" as const,
          provider: "local" as const,
        },
      };
    },
  },
  streamUuid: "stream-1",
  buildCrossSeamAnchor: () => undefined,
  buildEvidenceAnchor: () => undefined,
  buildQuotaContext: () => null,
  getCapabilityTransport: () => undefined,
  pushServerFrameToClient: async () => ({ ok: true, delivered: true }),
  ensureWsHelper: () => null,
  buildTraceContext: () => undefined,
  currentTeamUuid: () => null,
  getSessionUuid: () => "22222222-2222-4222-8222-222222222222",
});

describe("HP5 P2-02 — HookDispatcher injection", () => {
  it("assembly always exposes a HookDispatcher (no longer optional)", () => {
    const assembly = createSessionDoRuntimeAssembly(baseCtx());
    expect(assembly.hookDispatcher).toBeInstanceOf(HookDispatcher);
  });

  it("dispatcher with zero handlers returns an empty aggregate, preserving fail-closed semantics for permission helper", async () => {
    const assembly = createSessionDoRuntimeAssembly(baseCtx());
    const result = await assembly.hookDispatcher.emit("PreToolUse", {
      tool_name: "bash",
      tool_input: { command: "ls" },
    });
    expect(result.outcomes).toEqual([]);
    // Existing permission helper translates zero outcomes → "deny".
    // We don't import it here to avoid coupling, but the contract is
    // that aggregated outcomes for a never-handled emit are empty.
  });
});
