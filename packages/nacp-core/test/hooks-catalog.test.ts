import { describe, expect, it } from "vitest";
import {
  HOOK_EVENT_NAMES,
  HookEventNameSchema,
  HOOK_EVENT_PAYLOAD_SCHEMA_NAMES,
  HOOK_EVENT_PAYLOAD_SCHEMAS,
} from "../src/index.js";

describe("hook vocabulary consolidation", () => {
  it("freezes the current 18 hook event names", () => {
    expect(HOOK_EVENT_NAMES).toHaveLength(18);
    for (const name of HOOK_EVENT_NAMES) {
      expect(HookEventNameSchema.safeParse(name).success).toBe(true);
      expect(HOOK_EVENT_PAYLOAD_SCHEMA_NAMES[name]).toMatch(/Payload$/);
      expect(HOOK_EVENT_PAYLOAD_SCHEMAS[name]).toBeDefined();
    }
  });

  it("parses the current class A/B/D payload fixtures", () => {
    const fixtures = {
      SessionStart: { sessionUuid: null, turnId: "turn-001", content: "Hello" },
      SessionEnd: { turnCount: 0, timestamp: "2026-04-18T10:00:00.000Z" },
      UserPromptSubmit: { turnId: "turn-001", content: "What is 2+2?" },
      PreToolUse: { tool_name: "Bash", tool_input: "rm -rf /" },
      PostToolUse: { tool_name: "Read", tool_output: { bytes: 12 } },
      PostToolUseFailure: { tool_name: "Read", error_details: { message: "boom" } },
      PreCompact: { reason: "context-full", historyRef: "ref-42" },
      PostCompact: { summary_ref: { kind: "r2", key: "summary.json" } },
      Setup: { sessionUuid: null, turnId: "turn-001" },
      Stop: { reason: "session_end" },
      PermissionRequest: { capabilityName: "curl", tool_input: "https://example" },
      PermissionDenied: { capabilityName: "curl", reason: "workspace-escape" },
      ContextPressure: { usagePct: 0.72, nextAction: "arm" },
      ContextCompactArmed: { usagePct: 0.8, retry: true, retriesUsed: 1 },
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
    } as const;

    for (const name of HOOK_EVENT_NAMES) {
      expect(HOOK_EVENT_PAYLOAD_SCHEMAS[name].safeParse(fixtures[name]).success).toBe(true);
    }
  });
});
