/**
 * Tests for the hook event catalog.
 *
 * Locks the 8 canonical events, their blocking semantics, allowed
 * outcome allowlists (the crux of event-specific outcome contract)
 * and redaction metadata. These tests are the last line of defence
 * against silent drift from design §7.2 / action-plan §2.3.
 */

import { describe, it, expect } from "vitest";
import { HOOK_EVENT_CATALOG, isBlockingEvent } from "../src/catalog.js";
import type { HookEventName } from "../src/catalog.js";

const ALL_EVENTS: HookEventName[] = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PreCompact",
  "PostCompact",
];

describe("HOOK_EVENT_CATALOG", () => {
  it("registers exactly the 8 canonical events", () => {
    const registered = Object.keys(HOOK_EVENT_CATALOG).sort();
    expect(registered).toEqual([...ALL_EVENTS].sort());
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

    it("no event allows stop except PostToolUseFailure", () => {
      for (const name of ALL_EVENTS) {
        const allowsStop = HOOK_EVENT_CATALOG[name].allowedOutcomes.includes("stop");
        expect(allowsStop).toBe(name === "PostToolUseFailure");
      }
    });
  });

  describe("redaction hints", () => {
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
