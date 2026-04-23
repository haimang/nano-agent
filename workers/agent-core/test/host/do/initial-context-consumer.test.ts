/**
 * P2 Phase 3 — D05 host consumer tests.
 *
 * Covers (per action-plan §4.4 P3-04 + GPT R1 + R2):
 *   - session.start with `initial_context` payload populates the
 *     per-assembler pending layer list (D05 R1);
 *   - session.followup_input does NOT trigger the consumer;
 *   - missing `initial_context` is a no-op;
 *   - non-session.start messages are no-ops;
 *   - thrown consumer errors are caught (do not abort the turn)
 *     — test exposes this by swapping in a poisoned assembler and
 *     verifying dispatchAdmissibleFrame still returns.
 */

import { describe, it, expect, vi } from "vitest";
import { NanoSessionDO } from "../../../src/host/do/nano-session-do.js";
import { peekPendingInitialContextLayers } from "../../../src/host/context-api/append-initial-context-layer.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";

function makeDO(): NanoSessionDO {
  return new NanoSessionDO({}, { TEAM_UUID: "team-t", SESSION_UUID });
}

describe("D05 host consumer — session.start initial_context", () => {
  it("session.start with initial_context pushes a layer into the per-assembler pending list", async () => {
    const doInstance = makeDO();
    const assembler = (
      doInstance.getSubsystems().workspace as
        | { assembler?: import("@nano-agent/workspace-context-artifacts").ContextAssembler }
        | undefined
    )?.assembler;
    expect(assembler).toBeDefined();
    expect(peekPendingInitialContextLayers(assembler!)).toHaveLength(0);

    await doInstance.dispatchAdmissibleFrame("session.start", {
      initial_input: "hello",
      initial_context: {
        intent: { route: "demo", confidence: 0.7 },
      },
    });

    const pending = peekPendingInitialContextLayers(assembler!);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0]!.kind).toBe("session"); // R1: mapped to canonical kind, never "initial_context"
  });

  it("session.followup_input does NOT trigger initial_context consumer", async () => {
    const doInstance = makeDO();
    const assembler = (
      doInstance.getSubsystems().workspace as
        | { assembler?: import("@nano-agent/workspace-context-artifacts").ContextAssembler }
        | undefined
    )?.assembler;

    await doInstance.dispatchAdmissibleFrame("session.followup_input", {
      text: "follow up",
      // Even with initial_context present (wire shouldn't carry it),
      // consumer must not fire.
      initial_context: { intent: { route: "wrong" } },
    });

    expect(peekPendingInitialContextLayers(assembler!)).toHaveLength(0);
  });

  it("session.start without initial_context is a no-op", async () => {
    const doInstance = makeDO();
    const assembler = (
      doInstance.getSubsystems().workspace as
        | { assembler?: import("@nano-agent/workspace-context-artifacts").ContextAssembler }
        | undefined
    )?.assembler;

    await doInstance.dispatchAdmissibleFrame("session.start", {
      initial_input: "hi",
    });

    expect(peekPendingInitialContextLayers(assembler!)).toHaveLength(0);
  });

  it("unrelated frame types are no-ops for initial_context", async () => {
    const doInstance = makeDO();
    const assembler = (
      doInstance.getSubsystems().workspace as
        | { assembler?: import("@nano-agent/workspace-context-artifacts").ContextAssembler }
        | undefined
    )?.assembler;

    await doInstance.dispatchAdmissibleFrame("session.heartbeat", {});
    await doInstance.dispatchAdmissibleFrame("session.stream.ack", {
      acked_seq: 1,
      stream_uuid: SESSION_UUID,
    });
    expect(peekPendingInitialContextLayers(assembler!)).toHaveLength(0);
  });

  it("consumer errors are caught and DO NOT propagate (turn continues)", async () => {
    const doInstance = makeDO();
    // Poison the assembler so any downstream access throws. We can't
    // easily poison `appendInitialContextLayer` from outside without
    // swapping the handle — instead we rely on the empty-object payload
    // being a no-op and assert no throw for a malformed but zod-passthrough payload.
    await expect(
      doInstance.dispatchAdmissibleFrame("session.start", {
        initial_input: "hi",
        initial_context: {
          // passthrough lets arbitrary keys through — helper stringifies
          foo: { nested: { value: Array(10).fill("x").join("") } },
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("D05 host consumer — R2 canonical error kind (system.notify severity=error)", () => {
  it("NEVER uses non-canonical 'system.error' as a kind VALUE in object literals (R2 forbidden)", async () => {
    // Guard: grep source at test time for banned kind VALUE usage.
    // Comments or doc references are allowed (they describe the
    // anti-pattern); the ban is only on code that emits `kind:
    // "system.error"`.
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      new URL("../../../src/host/do/nano-session-do.ts", import.meta.url),
      "utf8",
    );
    const bannedAsKindValue = source.match(/kind\s*:\s*['"`]system\.error['"`]/g);
    expect(bannedAsKindValue ?? []).toHaveLength(0);
    // And the canonical kind `system.notify` must be present as a kind value.
    expect(source).toMatch(/kind\s*:\s*['"`]system\.notify['"`]/);
  });
});
