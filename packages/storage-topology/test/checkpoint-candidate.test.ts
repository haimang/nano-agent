/**
 * Tests for checkpoint candidate fields.
 */

import { describe, it, expect } from "vitest";
import {
  CHECKPOINT_CANDIDATE_FIELDS,
  summarizeFragments,
} from "../src/checkpoint-candidate.js";
import type { CheckpointFragment } from "../src/checkpoint-candidate.js";

describe("CHECKPOINT_CANDIDATE_FIELDS", () => {
  it("is a non-empty array", () => {
    expect(CHECKPOINT_CANDIDATE_FIELDS.length).toBeGreaterThan(0);
  });

  it("contains session_phase as a frozen field in the session fragment", () => {
    const sessionPhase = CHECKPOINT_CANDIDATE_FIELDS.find(
      (f) => f.fieldName === "session_phase",
    );
    expect(sessionPhase).toBeDefined();
    expect(sessionPhase!.provisional).toBe(false);
    expect(sessionPhase!.fragment).toBe("session");
    expect(sessionPhase!.source).toBe("session-phase");
    expect(sessionPhase!.pendingQuestions).toEqual([]);
  });

  it("contains messages as a provisional field in the kernel fragment", () => {
    const messages = CHECKPOINT_CANDIDATE_FIELDS.find(
      (f) => f.fieldName === "messages",
    );
    expect(messages).toBeDefined();
    expect(messages!.provisional).toBe(true);
    expect(messages!.fragment).toBe("kernel");
    expect(messages!.pendingQuestions.length).toBeGreaterThan(0);
  });

  it("contains replay_buffer / stream_seqs as frozen session-fragment fields", () => {
    for (const name of ["replay_buffer", "stream_seqs"] as const) {
      const field = CHECKPOINT_CANDIDATE_FIELDS.find((f) => f.fieldName === name);
      expect(field).toBeDefined();
      expect(field!.provisional).toBe(false);
      expect(field!.fragment).toBe("session");
    }
  });

  it("contains tool_inflight as a provisional kernel-fragment field owned by capability", () => {
    const toolInflight = CHECKPOINT_CANDIDATE_FIELDS.find(
      (f) => f.fieldName === "tool_inflight",
    );
    expect(toolInflight).toBeDefined();
    expect(toolInflight!.provisional).toBe(true);
    expect(toolInflight!.fragment).toBe("kernel");
    expect(toolInflight!.ownerRuntime).toBe("capability");
  });

  it("contains workspace_refs with a delegate-to-workspace MIME-gate note", () => {
    const ws = CHECKPOINT_CANDIDATE_FIELDS.find(
      (f) => f.fieldName === "workspace_refs",
    );
    expect(ws).toBeDefined();
    expect(ws!.fragment).toBe("workspace");
    expect(ws!.ownerRuntime).toBe("workspace");
    expect(ws!.mimeGate).toBe("delegate-to-workspace");
  });

  it("contains usage_snapshot as a frozen usage-fragment field owned by eval", () => {
    const u = CHECKPOINT_CANDIDATE_FIELDS.find((f) => f.fieldName === "usage_snapshot");
    expect(u).toBeDefined();
    expect(u!.fragment).toBe("usage");
    expect(u!.ownerRuntime).toBe("eval");
    expect(u!.provisional).toBe(false);
  });

  it("every field declares fragment + ownerRuntime + pendingQuestions", () => {
    const ALLOWED_FRAGMENTS: readonly CheckpointFragment[] = [
      "kernel",
      "session",
      "workspace",
      "hooks",
      "usage",
    ];
    for (const field of CHECKPOINT_CANDIDATE_FIELDS) {
      expect(ALLOWED_FRAGMENTS).toContain(field.fragment);
      expect(typeof field.ownerRuntime).toBe("string");
      expect(Array.isArray(field.pendingQuestions)).toBe(true);
      if (!field.provisional) {
        expect(field.pendingQuestions).toEqual([]);
      }
    }
  });

  it("all fields have required properties", () => {
    for (const field of CHECKPOINT_CANDIDATE_FIELDS) {
      expect(typeof field.fieldName).toBe("string");
      expect(field.fieldName.length).toBeGreaterThan(0);
      expect(typeof field.source).toBe("string");
      expect(field.source.length).toBeGreaterThan(0);
      expect(typeof field.provisional).toBe("boolean");
      expect(typeof field.notes).toBe("string");
      expect(field.notes.length).toBeGreaterThan(0);
    }
  });

  it("has unique field names", () => {
    const names = CHECKPOINT_CANDIDATE_FIELDS.map((f) => f.fieldName);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

describe("summarizeFragments", () => {
  it("returns a count for every fragment, with workspace / usage populated", () => {
    const summary = summarizeFragments();
    expect(summary.kernel).toBeGreaterThan(0);
    expect(summary.session).toBeGreaterThan(0);
    expect(summary.workspace).toBeGreaterThan(0);
    expect(summary.usage).toBeGreaterThan(0);
    expect(summary.hooks).toBeGreaterThanOrEqual(0);
    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    expect(total).toBe(CHECKPOINT_CANDIDATE_FIELDS.length);
  });
});
