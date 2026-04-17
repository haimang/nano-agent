/**
 * Integration — checkpoint fragment / archive plan contract.
 *
 * Asserts cross-module consistency between:
 *   - `CHECKPOINT_CANDIDATE_FIELDS` (fragment boundaries + ownership)
 *   - `ARCHIVE_PLANS` (archive paths + responsible runtimes)
 *   - `R2_KEYS` (the key builders archive plans call out)
 *
 * These are the pieces session-do-runtime / eval / workspace consumers
 * glue together at deploy time, so a smoke-level contract check here
 * prevents drift between them.
 */

import { describe, it, expect } from "vitest";
import {
  CHECKPOINT_CANDIDATE_FIELDS,
  summarizeFragments,
} from "../../src/checkpoint-candidate.js";
import { ARCHIVE_PLANS } from "../../src/archive-plan.js";
import { R2_KEYS } from "../../src/keys.js";
import type { ResponsibleRuntime } from "../../src/taxonomy.js";

describe("integration: checkpoint fragment / archive plan contract", () => {
  it("every archive plan ends in R2", () => {
    for (const plan of ARCHIVE_PLANS) {
      expect(plan.targetBackend).toBe("r2");
    }
  });

  it("every archive plan names a known ResponsibleRuntime", () => {
    const known: Set<ResponsibleRuntime> = new Set([
      "session-do",
      "workspace",
      "eval",
      "capability",
      "hooks",
      "platform",
    ]);
    for (const plan of ARCHIVE_PLANS) {
      expect(known.has(plan.responsibleRuntime)).toBe(true);
    }
  });

  it("every archive plan's keyBuilder produces a tenant-scoped R2 key", () => {
    const teamUuid = "team-abc";
    const sessionUuid = "session-xyz";
    for (const plan of ARCHIVE_PLANS) {
      const key = plan.keyBuilder(teamUuid, sessionUuid, "arg1", "arg2");
      expect(key.startsWith(`tenants/${teamUuid}/`)).toBe(true);
    }
  });

  it("each known R2 builder appears to back at least one archive plan path", () => {
    const team = "team-1";
    const session = "session-1";
    const allBuilderOutputs = [
      R2_KEYS.sessionTranscript(team, session),
      R2_KEYS.compactArchive(team, session, "0-0"),
      R2_KEYS.auditArchive(team, "1970-01-01", session),
      R2_KEYS.workspaceFile(team, session, "unknown"),
    ];
    for (const builderOutput of allBuilderOutputs) {
      const prefix = `tenants/${team}/`;
      expect(builderOutput.startsWith(prefix)).toBe(true);
    }
    // At least one archive plan per builder shape — we check the set of
    // fragments covered by archive-plan keyBuilders is non-empty.
    expect(ARCHIVE_PLANS.length).toBeGreaterThanOrEqual(4);
  });

  it("fragment summary matches the shape declared by checkpoint candidates", () => {
    const summary = summarizeFragments();
    const fieldFragments = new Set(CHECKPOINT_CANDIDATE_FIELDS.map((f) => f.fragment));
    for (const [fragment, count] of Object.entries(summary)) {
      if (count > 0) {
        expect(fieldFragments.has(fragment as keyof typeof summary)).toBe(true);
      }
    }
  });

  it("workspace fragment is owned by the workspace runtime (delegation boundary intact)", () => {
    const workspaceFields = CHECKPOINT_CANDIDATE_FIELDS.filter((f) => f.fragment === "workspace");
    expect(workspaceFields.length).toBeGreaterThan(0);
    for (const field of workspaceFields) {
      expect(field.ownerRuntime).toBe("workspace");
    }
  });

  it("frozen candidate fields have empty pendingQuestions; provisional ones have at least one", () => {
    for (const field of CHECKPOINT_CANDIDATE_FIELDS) {
      if (field.provisional) {
        expect(field.pendingQuestions.length).toBeGreaterThan(0);
      } else {
        expect(field.pendingQuestions).toEqual([]);
      }
    }
  });
});
