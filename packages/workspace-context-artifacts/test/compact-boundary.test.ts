import { describe, it, expect } from "vitest";
import { ContextCompactRequestBodySchema, ContextCompactResponseBodySchema } from "../../nacp-core/src/messages/context.js";
import { CompactBoundaryManager } from "../src/compact-boundary.js";
import type {
  ContextCompactRequestBody,
  ContextCompactResponseBody,
} from "../src/compact-boundary.js";
import type { ArtifactRef, NacpRefLike } from "../src/refs.js";

function makeRef(keySuffix: string, role: ArtifactRef["role"] = "attachment"): ArtifactRef {
  return {
    kind: "r2",
    binding: "WORKSPACE_R2",
    team_uuid: "team-1",
    key: `tenants/team-1/artifacts/compact-archive/${keySuffix}`,
    role,
    content_type: "text/plain",
    size_bytes: 500,
    artifactKind: "compact-archive",
    createdAt: "2026-04-17T00:00:00.000Z",
  };
}

function makeHistoryRef(): NacpRefLike {
  return {
    kind: "r2",
    binding: "WORKSPACE_R2",
    team_uuid: "team-1",
    key: "tenants/team-1/history/abc",
    role: "input",
  };
}

describe("CompactBoundaryManager.buildCompactRequest", () => {
  it("produces a body aligned with ContextCompactRequestBodySchema", () => {
    const mgr = new CompactBoundaryManager();
    const body: ContextCompactRequestBody = mgr.buildCompactRequest({
      historyRef: makeHistoryRef(),
      messages: [{ role: "user", content: "hi", tokenEstimate: 20 }],
      targetTokenBudget: 1000,
    });
    expect(body.target_token_budget).toBe(1000);
    expect(body.history_ref.key).toMatch(/^tenants\/team-1\//);
    expect(ContextCompactRequestBodySchema.safeParse(body).success).toBe(true);
  });

  it("rejects a negative / zero target_token_budget via the Core schema", () => {
    const mgr = new CompactBoundaryManager();
    const bad = mgr.buildCompactRequest({
      historyRef: makeHistoryRef(),
      messages: [],
      targetTokenBudget: 0,
    });
    expect(ContextCompactRequestBodySchema.safeParse(bad).success).toBe(false);
  });
});

describe("CompactBoundaryManager.pickSplitPoint (token-budget-aware)", () => {
  it("splits so the tail fits inside the target_token_budget (R6: no more midpoint split)", () => {
    const mgr = new CompactBoundaryManager();
    const messages = [
      { role: "user", content: "a", tokenEstimate: 100 }, // idx 0
      { role: "assistant", content: "b", tokenEstimate: 100 }, // idx 1
      { role: "user", content: "c", tokenEstimate: 100 }, // idx 2
      { role: "assistant", content: "d", tokenEstimate: 100 }, // idx 3
      { role: "user", content: "e", tokenEstimate: 100 }, // idx 4
    ];
    // Budget 250 → keep ~2 recent messages, compact the rest.
    const split = mgr.pickSplitPoint(messages, 250);
    expect(split).toBe(3); // compact indices 0..2, keep 3..4
  });

  it("falls back to content length when tokenEstimate is missing", () => {
    const mgr = new CompactBoundaryManager();
    const messages = [
      { role: "user", content: "a".repeat(400) }, // ~100 tokens
      { role: "user", content: "b".repeat(400) }, // ~100 tokens
      { role: "user", content: "c".repeat(400) }, // ~100 tokens
    ];
    const split = mgr.pickSplitPoint(messages, 150);
    expect(split).toBe(2); // keep the last one
  });

  it("always compacts at least one message even when everything fits", () => {
    const mgr = new CompactBoundaryManager();
    const messages = [
      { role: "user", content: "short", tokenEstimate: 5 },
      { role: "assistant", content: "short", tokenEstimate: 5 },
    ];
    const split = mgr.pickSplitPoint(messages, 1_000_000);
    expect(split).toBeGreaterThanOrEqual(1);
  });

  it("returns 0 for an empty message list", () => {
    const mgr = new CompactBoundaryManager();
    expect(mgr.pickSplitPoint([], 1000)).toBe(0);
  });
});

describe("CompactBoundaryManager.applyCompactResponse", () => {
  it("applies an ok response and records a boundary marker", () => {
    const mgr = new CompactBoundaryManager();
    const response: ContextCompactResponseBody = {
      status: "ok",
      summary_ref: {
        kind: "r2",
        binding: "WORKSPACE_R2",
        team_uuid: "team-1",
        key: "tenants/team-1/artifacts/compact-archive/summary-1",
        role: "output",
      },
      tokens_before: 2000,
      tokens_after: 200,
    };

    const result = mgr.applyCompactResponse(
      [{ role: "user", content: "recent" }],
      response,
      makeRef("summary-1"),
      "0-5",
    );

    if ("error" in result) {
      throw new Error("expected success result");
    }

    expect(result.boundary.turnRange).toBe("0-5");
    expect(result.messages).toHaveLength(2);
    const first = result.messages[0] as Record<string, unknown>;
    expect(first.role).toBe("system");
    expect(String(first.content)).toContain("Compact boundary");
    expect(ContextCompactResponseBodySchema.safeParse(response).success).toBe(true);
  });

  it("surfaces error responses without mutating the live messages", () => {
    const mgr = new CompactBoundaryManager();
    const response: ContextCompactResponseBody = {
      status: "error",
      error: { code: "SERVER_BUSY", message: "try again" },
    };
    const result = mgr.applyCompactResponse(
      [{ role: "user", content: "x" }],
      response,
      makeRef("unused"),
      "0-0",
    );
    expect("error" in result).toBe(true);
    expect(mgr.getBoundaryRecords()).toHaveLength(0);
  });

  it("accumulates boundary records across multiple successful compactions", () => {
    const mgr = new CompactBoundaryManager();
    const ok1: ContextCompactResponseBody = { status: "ok", tokens_before: 100, tokens_after: 10 };
    const ok2: ContextCompactResponseBody = { status: "ok", tokens_before: 200, tokens_after: 20 };

    mgr.applyCompactResponse([], ok1, makeRef("s1"), "0-5");
    mgr.applyCompactResponse([], ok2, makeRef("s2"), "6-10");

    const records = mgr.getBoundaryRecords();
    expect(records).toHaveLength(2);
    expect(records[0]!.turnRange).toBe("0-5");
    expect(records[1]!.turnRange).toBe("6-10");
  });

  it("getBoundaryRecords returns a copy", () => {
    const mgr = new CompactBoundaryManager();
    const ok: ContextCompactResponseBody = { status: "ok", tokens_before: 100, tokens_after: 10 };
    mgr.applyCompactResponse([], ok, makeRef("s1"), "0-1");

    const records = [...mgr.getBoundaryRecords()];
    records.push({
      turnRange: "fake",
      summaryRef: makeRef("fake"),
      archivedAt: "2026-04-17T00:00:00.000Z",
    });
    expect(mgr.getBoundaryRecords()).toHaveLength(1);
  });
});
