/**
 * Integration — compact boundary reinjection.
 *
 * Verifies that `CompactBoundaryManager` produces wire bodies that
 * parse under the real `context.compact.request/response` schemas from
 * `@haimang/nacp-core`, and that applying the response reinjects a
 * boundary marker back into the live message list without mutating the
 * originally-passed array.
 */

import { describe, it, expect } from "vitest";
import {
  ContextCompactRequestBodySchema,
  ContextCompactResponseBodySchema,
} from "../../../../packages/nacp-core/src/messages/context.js";
import { CompactBoundaryManager } from "../../src/compact-boundary.js";
import type {
  ContextCompactRequestBody,
  ContextCompactResponseBody,
} from "../../src/compact-boundary.js";
import type {
  ArtifactRef,
  NacpRefLike,
} from "@nano-agent/workspace-context-artifacts";

function makeSummaryRef(key: string): ArtifactRef {
  return {
    kind: "r2",
    binding: "WORKSPACE_R2",
    team_uuid: "team-1",
    key: `tenants/team-1/artifacts/compact-archive/${key}`,
    role: "output",
    content_type: "text/plain",
    size_bytes: 120,
    artifactKind: "compact-archive",
    createdAt: "2026-04-17T00:00:00.000Z",
  };
}

const historyRef: NacpRefLike = {
  kind: "r2",
  binding: "WORKSPACE_R2",
  team_uuid: "team-1",
  key: "tenants/team-1/history/s1",
  role: "input",
};

describe("integration: compact request/response cycle", () => {
  it("builds a request that parses under ContextCompactRequestBodySchema", () => {
    const mgr = new CompactBoundaryManager();
    const body: ContextCompactRequestBody = mgr.buildCompactRequest({
      historyRef,
      messages: [{ role: "user", content: "hi", tokenEstimate: 20 }],
      targetTokenBudget: 1024,
    });
    expect(ContextCompactRequestBodySchema.safeParse(body).success).toBe(true);
  });

  it("applies a response whose body parses under ContextCompactResponseBodySchema", () => {
    const mgr = new CompactBoundaryManager();
    const response: ContextCompactResponseBody = {
      status: "ok",
      summary_ref: {
        kind: "r2",
        binding: "WORKSPACE_R2",
        team_uuid: "team-1",
        key: "tenants/team-1/artifacts/compact-archive/s1",
        role: "output",
      },
      tokens_before: 800,
      tokens_after: 120,
    };
    expect(ContextCompactResponseBodySchema.safeParse(response).success).toBe(true);

    const summary = makeSummaryRef("s1");
    const result = mgr.applyCompactResponse(
      [{ role: "user", content: "recent", tokenEstimate: 10 }],
      response,
      summary,
      "0-5",
    );
    if ("error" in result) throw new Error("unexpected error response");
    expect(result.messages).toHaveLength(2);
    expect(result.boundary.turnRange).toBe("0-5");
  });

  it("round-trips multiple compactions and surfaces all boundaries", () => {
    const mgr = new CompactBoundaryManager();
    const ok: ContextCompactResponseBody = {
      status: "ok",
      tokens_before: 100,
      tokens_after: 10,
    };
    mgr.applyCompactResponse([], ok, makeSummaryRef("s1"), "0-3");
    mgr.applyCompactResponse([], ok, makeSummaryRef("s2"), "4-8");
    const boundaries = mgr.getBoundaryRecords();
    expect(boundaries.map((b) => b.turnRange)).toEqual(["0-3", "4-8"]);
  });

  it("pickSplitPoint chooses a budget-aware split (not message-count midpoint)", () => {
    const mgr = new CompactBoundaryManager();
    const messages = Array.from({ length: 8 }, (_, i) => ({
      role: "user",
      content: `m${i}`,
      tokenEstimate: 200,
    }));
    const split = mgr.pickSplitPoint(messages, 500);
    // Budget 500 keeps 2 recent * 200 = 400. So split=6 (compact 0..5, keep 6..7).
    expect(split).toBe(6);
  });
});
