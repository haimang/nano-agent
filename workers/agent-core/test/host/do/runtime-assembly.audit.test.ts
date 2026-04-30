import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RUNTIME_CONFIG } from "../../../src/host/env.js";
import { createSessionDoRuntimeAssembly } from "../../../src/host/do/session-do/runtime-assembly.js";

describe("createSessionDoRuntimeAssembly hook audit wiring", () => {
  it("persists hook.outcome when a hook denies the turn", async () => {
    const audits: Array<Record<string, unknown>> = [];
    const recordAuditEvent = vi.fn(async (record: Record<string, unknown>) => {
      audits.push(record);
      return { ok: true };
    });

    const assembly = createSessionDoRuntimeAssembly({
      env: {
        ORCHESTRATOR_CORE: {
          recordAuditEvent,
        },
      },
      config: DEFAULT_RUNTIME_CONFIG,
      compositionFactory: {
        create() {
          return {
            kernel: { phase: "P2-stub", reason: "test" },
            llm: { phase: "P2-stub", reason: "test" },
            capability: { serviceBindingTransport: null, transport: "unavailable", reason: "test" },
            workspace: null,
            hooks: {
              emit: async () => ({
                ok: false,
                block: { reason: "policy denied" },
              }),
            },
            eval: { emit: vi.fn() },
            storage: { phase: "host-local", reason: "test" },
            profile: { capability: "local", hooks: "local", provider: "local" },
          };
        },
      },
      streamUuid: "stream-1",
      buildCrossSeamAnchor: () => ({
        traceUuid: "11111111-1111-4111-8111-111111111111",
        sessionUuid: "22222222-2222-4222-8222-222222222222",
        teamUuid: "33333333-3333-4333-8333-333333333333",
        requestUuid: "44444444-4444-4444-8444-444444444444",
        sourceRole: "session",
      }),
      buildEvidenceAnchor: () => undefined,
      buildQuotaContext: () => null,
      getCapabilityTransport: () => undefined,
      pushServerFrameToClient: async () => ({ ok: true, delivered: true }),
      ensureWsHelper: () => null,
      buildTraceContext: () => ({
        traceUuid: "11111111-1111-4111-8111-111111111111",
        sessionUuid: "22222222-2222-4222-8222-222222222222",
        teamUuid: "33333333-3333-4333-8333-333333333333",
        sourceRole: "session",
      }),
      currentTeamUuid: () => "33333333-3333-4333-8333-333333333333",
      getSessionUuid: () => "22222222-2222-4222-8222-222222222222",
    });

    await assembly.orchestrator.startTurn(assembly.state, {
      kind: "session-start-initial-input",
      content: "hello",
      turnId: "turn-1",
      receivedAt: "2026-04-30T00:00:00.000Z",
      messageType: "session.start",
    });

    expect(recordAuditEvent).toHaveBeenCalled();
    expect(audits.some((record) => record.event_kind === "hook.outcome")).toBe(true);
    expect(audits[0]?.session_uuid).toBe("22222222-2222-4222-8222-222222222222");
    expect(audits[0]?.team_uuid).toBe("33333333-3333-4333-8333-333333333333");
    expect(audits[0]?.outcome).toBe("denied");
  });
});
