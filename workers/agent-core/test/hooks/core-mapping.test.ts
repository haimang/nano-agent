/**
 * Tests for Core message mapping.
 *
 * These tests verify the builder/parser pair round-trips through the
 * real `@haimang/nacp-core` `HookEmitBodySchema` and
 * `HookOutcomeBodySchema` — which is the reality we're aligning to.
 */

import { describe, it, expect } from "vitest";
import {
  HookEmitBodySchema,
  HookOutcomeBodySchema,
} from "@haimang/nacp-core";
import {
  buildHookEmitBody,
  buildHookOutcomeBody,
  parseHookOutcomeBody,
} from "../../src/hooks/core-mapping.js";
import type { HookOutcome } from "../../src/hooks/outcome.js";

describe("buildHookEmitBody", () => {
  it("produces a body that parses under HookEmitBodySchema", () => {
    const body = buildHookEmitBody("PreToolUse", {
      tool_name: "Bash",
      tool_input: "ls -la",
    });
    expect(body.event_name).toBe("PreToolUse");
    expect(body.event_payload).toEqual({
      tool_name: "Bash",
      tool_input: "ls -la",
    });

    const parsed = HookEmitBodySchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it("wraps a non-object payload into { value: ... } so it satisfies event_payload: Record", () => {
    const body = buildHookEmitBody("SessionStart", "hello");
    expect(body.event_payload).toEqual({ value: "hello" });
    expect(HookEmitBodySchema.safeParse(body).success).toBe(true);
  });

  it("wraps arrays into { value: [...] }", () => {
    const body = buildHookEmitBody("PostToolUse", [1, 2, 3]);
    expect(body.event_payload).toEqual({ value: [1, 2, 3] });
  });

  it("rejects empty or oversized event names", () => {
    expect(() => buildHookEmitBody("", {})).toThrow(/event_name/);
    expect(() => buildHookEmitBody("x".repeat(65), {})).toThrow(/event_name/);
  });
});

describe("parseHookOutcomeBody", () => {
  const ctx = { handlerId: "h-1", durationMs: 42 };

  it("parses a minimal ok=true body as a continue outcome", () => {
    const outcome = parseHookOutcomeBody({ ok: true }, ctx);
    expect(outcome.action).toBe("continue");
    expect(outcome.handlerId).toBe("h-1");
    expect(outcome.durationMs).toBe(42);
    expect(outcome.updatedInput).toBeUndefined();
    expect(outcome.additionalContext).toBeUndefined();
  });

  it("derives action='block' from { ok: false, block: { reason } }", () => {
    const outcome = parseHookOutcomeBody(
      { ok: false, block: { reason: "policy violation" } },
      ctx,
    );
    expect(outcome.action).toBe("block");
    expect(outcome.additionalContext).toBe("policy violation");
  });

  it("derives action='stop' from { ok: true, stop: true }", () => {
    const outcome = parseHookOutcomeBody({ ok: true, stop: true }, ctx);
    expect(outcome.action).toBe("stop");
  });

  it("keeps updated_input as the domain updatedInput", () => {
    const outcome = parseHookOutcomeBody(
      { ok: true, updated_input: { tool_input: "safe" } },
      ctx,
    );
    expect(outcome.updatedInput).toEqual({ tool_input: "safe" });
  });

  it("keeps additional_context (when no block) as additionalContext", () => {
    const outcome = parseHookOutcomeBody(
      { ok: true, additional_context: "ran ok" },
      ctx,
    );
    expect(outcome.additionalContext).toBe("ran ok");
  });

  it("maps diagnostics (string) to { message: ... }", () => {
    const outcome = parseHookOutcomeBody(
      { ok: true, diagnostics: "slow" },
      ctx,
    );
    expect(outcome.diagnostics).toEqual({ message: "slow" });
  });

  it("rejects non-object bodies", () => {
    expect(() => parseHookOutcomeBody(null, ctx)).toThrow();
    expect(() => parseHookOutcomeBody(42, ctx)).toThrow();
    expect(() => parseHookOutcomeBody("hi", ctx)).toThrow();
  });

  it("rejects bodies missing 'ok'", () => {
    expect(() => parseHookOutcomeBody({ block: { reason: "nope" } }, ctx)).toThrow(/ok/);
  });

  it("rejects block without a reason string", () => {
    expect(() => parseHookOutcomeBody({ ok: false, block: {} }, ctx)).toThrow(/reason/);
  });

  it("accepts bodies that also parse under HookOutcomeBodySchema", () => {
    const samples = [
      { ok: true },
      { ok: false, block: { reason: "nope" } },
      { ok: true, stop: true },
      { ok: true, updated_input: { foo: "bar" } },
      { ok: true, additional_context: "ok", diagnostics: "slow" },
    ];
    for (const s of samples) {
      expect(HookOutcomeBodySchema.safeParse(s).success).toBe(true);
      expect(() => parseHookOutcomeBody(s, ctx)).not.toThrow();
    }
  });
});

describe("buildHookOutcomeBody (inverse)", () => {
  function oc(overrides: Partial<HookOutcome>): HookOutcome {
    return {
      action: "continue",
      handlerId: "h",
      durationMs: 1,
      ...overrides,
    };
  }

  it("emits ok=true for continue outcomes, validated by HookOutcomeBodySchema", () => {
    const body = buildHookOutcomeBody(oc({ action: "continue" }));
    expect(body.ok).toBe(true);
    expect(HookOutcomeBodySchema.safeParse(body).success).toBe(true);
  });

  it("emits ok=false + block for block outcomes", () => {
    const body = buildHookOutcomeBody(
      oc({ action: "block", additionalContext: "policy" }),
    );
    expect(body.ok).toBe(false);
    expect(body.block?.reason).toBe("policy");
    expect(HookOutcomeBodySchema.safeParse(body).success).toBe(true);
  });

  it("emits stop=true for stop outcomes", () => {
    const body = buildHookOutcomeBody(oc({ action: "stop" }));
    expect(body.stop).toBe(true);
    expect(HookOutcomeBodySchema.safeParse(body).success).toBe(true);
  });

  it("carries updatedInput through as updated_input", () => {
    const body = buildHookOutcomeBody(
      oc({ action: "continue", updatedInput: { tool_input: "x" } }),
    );
    expect(body.updated_input).toEqual({ tool_input: "x" });
  });

  it("round-trip: build → parse preserves action / updatedInput / additionalContext", () => {
    const original = oc({
      action: "continue",
      updatedInput: { tool_input: "safe" },
      additionalContext: "ran",
    });
    const body = buildHookOutcomeBody(original);
    const parsed = parseHookOutcomeBody(body, { handlerId: "h", durationMs: 1 });
    expect(parsed.action).toBe("continue");
    expect(parsed.updatedInput).toEqual({ tool_input: "safe" });
    expect(parsed.additionalContext).toBe("ran");
  });
});

// ────────────────────────────────────────────────────────────────────
// §B5 — v2 catalog names all parse under current wire schemas
// ────────────────────────────────────────────────────────────────────

describe("buildHookEmitBody — B5 v2 event names", () => {
  const V2_NAMES = [
    // Class B
    "Setup",
    "Stop",
    "PermissionRequest",
    "PermissionDenied",
    // Class D
    "ContextPressure",
    "ContextCompactArmed",
    "ContextCompactPrepareStarted",
    "ContextCompactCommitted",
    "ContextCompactFailed",
    "EvalSinkOverflow",
  ] as const;

  it("every v2 name still fits the 1-64 char event_name constraint", () => {
    for (const name of V2_NAMES) {
      expect(name.length).toBeGreaterThanOrEqual(1);
      expect(name.length).toBeLessThanOrEqual(64);
    }
  });

  it("every v2 name produces a body that parses under HookEmitBodySchema", () => {
    const payloads: Record<string, Record<string, unknown>> = {
      Setup: { sessionUuid: "s-1", env: { mode: "dev" } },
      Stop: { reason: "session_end" },
      PermissionRequest: { capabilityName: "curl", tool_input: "https://example" },
      PermissionDenied: { capabilityName: "curl", reason: "workspace-escape" },
      ContextPressure: { usagePct: 0.72 },
      ContextCompactArmed: { usagePct: 0.8 },
      ContextCompactPrepareStarted: {
        prepareJobId: "p-1",
        snapshotVersion: 2,
        tokenEstimate: 120000,
      },
      ContextCompactCommitted: {
        oldVersion: 2,
        newVersion: 3,
        summary: { storage: "do", storageKey: "k", sizeBytes: 1234 },
      },
      ContextCompactFailed: {
        reason: "timeout-60000ms",
        retriesUsed: 1,
        retryBudget: 3,
        terminal: false,
      },
      EvalSinkOverflow: {
        droppedCount: 12,
        capacity: 50,
        sinkId: "session-inspector",
      },
    };
    for (const name of V2_NAMES) {
      const body = buildHookEmitBody(name, payloads[name]);
      expect(HookEmitBodySchema.safeParse(body).success).toBe(true);
      expect(body.event_name).toBe(name);
    }
  });
});

describe("parseHookOutcomeBody — PermissionRequest wire truth (B5 §2.3)", () => {
  const ctx = { handlerId: "policy-handler", durationMs: 4 };

  it("continue (ok=true) maps to `continue` — wire-level `allow` verdict", () => {
    const outcome = parseHookOutcomeBody({ ok: true }, ctx);
    expect(outcome.action).toBe("continue");
  });

  it("block { reason } maps to `block` — wire-level `deny` verdict", () => {
    const outcome = parseHookOutcomeBody(
      { ok: false, block: { reason: "outside workspace" } },
      ctx,
    );
    expect(outcome.action).toBe("block");
    expect(outcome.additionalContext).toBe("outside workspace");
  });

  it("does NOT recognise an `allow` / `deny` wire field (they are package-local aliases only)", () => {
    const body = { ok: true, allow: true, deny: false } as unknown as Record<string, unknown>;
    // The parser ignores unknown fields; the action falls back to `continue`.
    const outcome = parseHookOutcomeBody(body, ctx);
    expect(outcome.action).toBe("continue");
  });
});
