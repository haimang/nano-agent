/**
 * Tests for the v2 hook event catalog (B5 expansion — 18 events).
 *
 * Locks:
 *   - The 18 canonical events across Class A (8) / B (4) / D (6).
 *   - Per-event blocking semantics.
 *   - Per-event allowed outcome allowlists (the crux of event-specific
 *     outcome contract).
 *   - Redaction metadata.
 *
 * These tests are the last line of defence against silent drift from
 * `docs/design/after-foundations/P4-hooks-catalog-expansion.md §3-§7`,
 * the PX async-compact lifecycle spec §7, and the B5 action-plan §2.3
 * override that keeps the wire truth unchanged.
 */

import { describe, it, expect } from "vitest";
import {
  HOOK_EVENT_CATALOG,
  isBlockingEvent,
  ASYNC_COMPACT_HOOK_EVENTS,
  CLASS_B_HOOK_EVENTS,
} from "../src/catalog.js";
import type { HookEventName } from "../src/catalog.js";

// ── Canonical v2 event inventory ───────────────────────────────────────

const CLASS_A: HookEventName[] = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PreCompact",
  "PostCompact",
];

const CLASS_B: HookEventName[] = [
  "Setup",
  "Stop",
  "PermissionRequest",
  "PermissionDenied",
];

const CLASS_D: HookEventName[] = [
  "ContextPressure",
  "ContextCompactArmed",
  "ContextCompactPrepareStarted",
  "ContextCompactCommitted",
  "ContextCompactFailed",
  "EvalSinkOverflow",
];

const ALL_EVENTS: HookEventName[] = [...CLASS_A, ...CLASS_B, ...CLASS_D];

describe("HOOK_EVENT_CATALOG (v2 — 18 events)", () => {
  it("registers exactly the 18 canonical events across 3 classes", () => {
    const registered = Object.keys(HOOK_EVENT_CATALOG).sort();
    expect(registered).toEqual([...ALL_EVENTS].sort());
    expect(registered.length).toBe(18);
  });

  it("every entry carries payloadSchema, redactionHints, allowedOutcomes, blocking", () => {
    for (const name of ALL_EVENTS) {
      const meta = HOOK_EVENT_CATALOG[name];
      expect(typeof meta.blocking).toBe("boolean");
      expect(Array.isArray(meta.allowedOutcomes)).toBe(true);
      expect(Array.isArray(meta.redactionHints)).toBe(true);
      expect(typeof meta.payloadSchema).toBe("string");
      expect(meta.payloadSchema.length).toBeGreaterThan(0);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // §A — Class A (unchanged — regression guard)
  // ─────────────────────────────────────────────────────────────────────

  describe("Class A — 8 events (unchanged)", () => {
    describe("blocking semantics", () => {
      it("UserPromptSubmit / PreToolUse / PreCompact are blocking", () => {
        expect(isBlockingEvent("UserPromptSubmit")).toBe(true);
        expect(isBlockingEvent("PreToolUse")).toBe(true);
        expect(isBlockingEvent("PreCompact")).toBe(true);
      });

      it("SessionStart / SessionEnd / PostToolUse / PostToolUseFailure / PostCompact are non-blocking", () => {
        expect(isBlockingEvent("SessionStart")).toBe(false);
        expect(isBlockingEvent("SessionEnd")).toBe(false);
        expect(isBlockingEvent("PostToolUse")).toBe(false);
        expect(isBlockingEvent("PostToolUseFailure")).toBe(false);
        expect(isBlockingEvent("PostCompact")).toBe(false);
      });
    });

    describe("allowed outcome contract (design §7.2)", () => {
      it("SessionStart allows additionalContext + diagnostics only", () => {
        expect([...HOOK_EVENT_CATALOG.SessionStart.allowedOutcomes].sort()).toEqual([
          "additionalContext",
          "diagnostics",
        ]);
      });

      it("SessionEnd allows diagnostics only", () => {
        expect([...HOOK_EVENT_CATALOG.SessionEnd.allowedOutcomes]).toEqual(["diagnostics"]);
      });

      it("UserPromptSubmit allows block + additionalContext + diagnostics (NO updatedInput)", () => {
        const set = new Set(HOOK_EVENT_CATALOG.UserPromptSubmit.allowedOutcomes);
        expect(set.has("block")).toBe(true);
        expect(set.has("additionalContext")).toBe(true);
        expect(set.has("diagnostics")).toBe(true);
        expect(set.has("updatedInput")).toBe(false);
      });

      it("PreToolUse is the ONLY event that allows updatedInput", () => {
        for (const name of ALL_EVENTS) {
          const allowsUpdatedInput = HOOK_EVENT_CATALOG[name].allowedOutcomes.includes("updatedInput");
          if (name === "PreToolUse") {
            expect(allowsUpdatedInput).toBe(true);
          } else {
            expect(allowsUpdatedInput).toBe(false);
          }
        }
      });

      it("PreToolUse allows block + updatedInput + additionalContext + diagnostics", () => {
        const set = new Set(HOOK_EVENT_CATALOG.PreToolUse.allowedOutcomes);
        expect(set.has("block")).toBe(true);
        expect(set.has("updatedInput")).toBe(true);
        expect(set.has("additionalContext")).toBe(true);
        expect(set.has("diagnostics")).toBe(true);
      });

      it("PostToolUse allows additionalContext + diagnostics only (no block/stop)", () => {
        const set = new Set(HOOK_EVENT_CATALOG.PostToolUse.allowedOutcomes);
        expect(set.has("block")).toBe(false);
        expect(set.has("stop")).toBe(false);
        expect(set.has("additionalContext")).toBe(true);
        expect(set.has("diagnostics")).toBe(true);
      });

      it("PostToolUseFailure allows stop (per design §7.2)", () => {
        const set = new Set(HOOK_EVENT_CATALOG.PostToolUseFailure.allowedOutcomes);
        expect(set.has("stop")).toBe(true);
        expect(set.has("additionalContext")).toBe(true);
        expect(set.has("diagnostics")).toBe(true);
      });

      it("PreCompact allows block + diagnostics", () => {
        const set = new Set(HOOK_EVENT_CATALOG.PreCompact.allowedOutcomes);
        expect(set.has("block")).toBe(true);
        expect(set.has("diagnostics")).toBe(true);
      });

      it("PostCompact allows additionalContext + diagnostics (per design §7.2)", () => {
        const set = new Set(HOOK_EVENT_CATALOG.PostCompact.allowedOutcomes);
        expect(set.has("additionalContext")).toBe(true);
        expect(set.has("diagnostics")).toBe(true);
      });

      it("`stop` is ONLY allowed on PostToolUseFailure across the whole catalog", () => {
        for (const name of ALL_EVENTS) {
          const allowsStop = HOOK_EVENT_CATALOG[name].allowedOutcomes.includes("stop");
          expect(allowsStop).toBe(name === "PostToolUseFailure");
        }
      });
    });

    describe("redaction hints (class A baseline)", () => {
      it("UserPromptSubmit redacts user_input", () => {
        expect(HOOK_EVENT_CATALOG.UserPromptSubmit.redactionHints).toContain("user_input");
      });

      it("PreToolUse redacts tool_input", () => {
        expect(HOOK_EVENT_CATALOG.PreToolUse.redactionHints).toContain("tool_input");
      });

      it("PostToolUse redacts tool_output", () => {
        expect(HOOK_EVENT_CATALOG.PostToolUse.redactionHints).toContain("tool_output");
      });

      it("PostToolUseFailure redacts error_details", () => {
        expect(HOOK_EVENT_CATALOG.PostToolUseFailure.redactionHints).toContain("error_details");
      });

      it("Session* and *Compact events have no redaction hints", () => {
        expect(HOOK_EVENT_CATALOG.SessionStart.redactionHints).toEqual([]);
        expect(HOOK_EVENT_CATALOG.SessionEnd.redactionHints).toEqual([]);
        expect(HOOK_EVENT_CATALOG.PreCompact.redactionHints).toEqual([]);
        expect(HOOK_EVENT_CATALOG.PostCompact.redactionHints).toEqual([]);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // §B — Class B (new — Setup / Stop / Permission*)
  // ─────────────────────────────────────────────────────────────────────

  describe("Class B — 4 new events", () => {
    it("exposes the Class B inventory via CLASS_B_HOOK_EVENTS", () => {
      expect([...CLASS_B_HOOK_EVENTS].sort()).toEqual([...CLASS_B].sort());
    });

    describe("Setup", () => {
      it("is non-blocking and allows additionalContext + diagnostics", () => {
        expect(isBlockingEvent("Setup")).toBe(false);
        expect([...HOOK_EVENT_CATALOG.Setup.allowedOutcomes].sort()).toEqual([
          "additionalContext",
          "diagnostics",
        ]);
      });

      it("has no redaction hints", () => {
        expect(HOOK_EVENT_CATALOG.Setup.redactionHints).toEqual([]);
      });
    });

    describe("Stop", () => {
      it("is non-blocking and allows diagnostics only", () => {
        expect(isBlockingEvent("Stop")).toBe(false);
        expect([...HOOK_EVENT_CATALOG.Stop.allowedOutcomes]).toEqual(["diagnostics"]);
      });

      it("has no redaction hints", () => {
        expect(HOOK_EVENT_CATALOG.Stop.redactionHints).toEqual([]);
      });
    });

    describe("PermissionRequest", () => {
      it("is blocking (executor awaits verdict before running the plan)", () => {
        expect(isBlockingEvent("PermissionRequest")).toBe(true);
      });

      it("allowedOutcomes contain `block` — wire deny == block (B5 §2.3)", () => {
        const set = new Set(HOOK_EVENT_CATALOG.PermissionRequest.allowedOutcomes);
        expect(set.has("block")).toBe(true);
        expect(set.has("additionalContext")).toBe(true);
        expect(set.has("diagnostics")).toBe(true);
      });

      it("does NOT invent `allow` / `deny` outcome actions on the wire", () => {
        const allowed = HOOK_EVENT_CATALOG.PermissionRequest.allowedOutcomes;
        expect(allowed.includes("allow")).toBe(false);
        expect(allowed.includes("deny")).toBe(false);
      });

      it("redacts tool_input", () => {
        expect(HOOK_EVENT_CATALOG.PermissionRequest.redactionHints).toContain("tool_input");
      });
    });

    describe("PermissionDenied", () => {
      it("is non-blocking and allows additionalContext + diagnostics", () => {
        expect(isBlockingEvent("PermissionDenied")).toBe(false);
        const set = new Set(HOOK_EVENT_CATALOG.PermissionDenied.allowedOutcomes);
        expect(set.has("additionalContext")).toBe(true);
        expect(set.has("diagnostics")).toBe(true);
        expect(set.has("block")).toBe(false);
      });

      it("redacts tool_input", () => {
        expect(HOOK_EVENT_CATALOG.PermissionDenied.redactionHints).toContain("tool_input");
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // §D — Class D (new — Context* / EvalSinkOverflow)
  // ─────────────────────────────────────────────────────────────────────

  describe("Class D — 6 new events (async-compact lifecycle + eval sink)", () => {
    it("exposes the 5 async-compact lifecycle names via ASYNC_COMPACT_HOOK_EVENTS", () => {
      expect([...ASYNC_COMPACT_HOOK_EVENTS].sort()).toEqual(
        [
          "ContextCompactArmed",
          "ContextCompactCommitted",
          "ContextCompactFailed",
          "ContextCompactPrepareStarted",
          "ContextPressure",
        ].sort(),
      );
    });

    it("every Class D event is non-blocking", () => {
      for (const name of CLASS_D) {
        expect(isBlockingEvent(name)).toBe(false);
      }
    });

    it("every Class D event has no redaction hints (payloads are operational metadata)", () => {
      for (const name of CLASS_D) {
        expect(HOOK_EVENT_CATALOG[name].redactionHints).toEqual([]);
      }
    });

    describe("per-event allowlist (mirrors P4 §3 / PX spec §7)", () => {
      it("ContextPressure allows additionalContext + diagnostics", () => {
        const set = new Set(HOOK_EVENT_CATALOG.ContextPressure.allowedOutcomes);
        expect(set.has("additionalContext")).toBe(true);
        expect(set.has("diagnostics")).toBe(true);
      });

      it("ContextCompactArmed allows diagnostics only", () => {
        expect([...HOOK_EVENT_CATALOG.ContextCompactArmed.allowedOutcomes]).toEqual([
          "diagnostics",
        ]);
      });

      it("ContextCompactPrepareStarted allows diagnostics only", () => {
        expect([
          ...HOOK_EVENT_CATALOG.ContextCompactPrepareStarted.allowedOutcomes,
        ]).toEqual(["diagnostics"]);
      });

      it("ContextCompactCommitted allows additionalContext + diagnostics", () => {
        const set = new Set(HOOK_EVENT_CATALOG.ContextCompactCommitted.allowedOutcomes);
        expect(set.has("additionalContext")).toBe(true);
        expect(set.has("diagnostics")).toBe(true);
      });

      it("ContextCompactFailed allows diagnostics only", () => {
        expect([...HOOK_EVENT_CATALOG.ContextCompactFailed.allowedOutcomes]).toEqual([
          "diagnostics",
        ]);
      });

      it("EvalSinkOverflow allows additionalContext + diagnostics (B6 producer gate)", () => {
        const set = new Set(HOOK_EVENT_CATALOG.EvalSinkOverflow.allowedOutcomes);
        expect(set.has("additionalContext")).toBe(true);
        expect(set.has("diagnostics")).toBe(true);
      });
    });

    it("NO Class D event permits block / stop / updatedInput — they're purely observational", () => {
      for (const name of CLASS_D) {
        const allowed = HOOK_EVENT_CATALOG[name].allowedOutcomes;
        expect(allowed.includes("block")).toBe(false);
        expect(allowed.includes("stop")).toBe(false);
        expect(allowed.includes("updatedInput")).toBe(false);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Cross-class invariants
  // ─────────────────────────────────────────────────────────────────────

  describe("cross-class invariants", () => {
    it("blocking events are exactly { UserPromptSubmit, PreToolUse, PreCompact, PermissionRequest }", () => {
      const blocking = ALL_EVENTS.filter((name) => isBlockingEvent(name)).sort();
      expect(blocking).toEqual([
        "PermissionRequest",
        "PreCompact",
        "PreToolUse",
        "UserPromptSubmit",
      ]);
    });

    it("payloadSchema names are unique across the catalog", () => {
      const schemas = ALL_EVENTS.map((name) => HOOK_EVENT_CATALOG[name].payloadSchema);
      expect(new Set(schemas).size).toBe(schemas.length);
    });
  });
});
