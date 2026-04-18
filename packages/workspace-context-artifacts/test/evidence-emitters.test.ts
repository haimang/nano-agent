/**
 * A7 Phase 3 — workspace evidence emitters tests.
 *
 * Pins each `build*Evidence()` shape so callers can rely on a stable
 * record format that downstream sinks (eval-observability + verdict
 * bundle) consume.
 */

import { describe, it, expect } from "vitest";
import {
  buildAssemblyEvidence,
  buildCompactEvidence,
  buildArtifactEvidence,
  buildSnapshotEvidence,
  emitAssemblyEvidence,
  emitCompactEvidence,
  emitArtifactEvidence,
  emitSnapshotEvidence,
  type EvidenceAnchorLike,
  type EvidenceSinkLike,
} from "../src/evidence-emitters.js";
import type { AssemblyResult } from "../src/context-assembler.js";
import type {
  ContextCompactRequestBody,
  ContextCompactResponseBody,
} from "../src/compact-boundary.js";
import type { WorkspaceSnapshotFragment } from "../src/snapshot.js";

const ANCHOR: EvidenceAnchorLike = {
  traceUuid: "11111111-1111-4111-8111-111111111111",
  sessionUuid: "22222222-2222-4222-8222-222222222222",
  teamUuid: "team-evidence",
  sourceRole: "session",
  sourceKey: "nano-agent.session.do@v1",
  timestamp: "2026-04-18T10:00:00.000Z",
};

class CapturingSink implements EvidenceSinkLike {
  readonly emitted: unknown[] = [];
  emit(record: unknown): void {
    this.emitted.push(record);
  }
}

describe("buildAssemblyEvidence", () => {
  it("captures assembled / dropped / order / token / truncation fields", () => {
    const result: AssemblyResult = {
      assembled: [
        { kind: "system", content: "x", tokens: 10 },
        { kind: "session", content: "y", tokens: 20 },
      ],
      totalTokens: 30,
      truncated: true,
      orderApplied: ["system", "session"],
    };
    const evidence = buildAssemblyEvidence(ANCHOR, {
      result,
      consideredKinds: [
        "system",
        "session",
        "workspace_summary",
        "recent_transcript",
      ],
      preparedArtifactsUsed: 1,
      requiredLayerBudgetViolation: false,
      dropReason: "budget exceeded",
    }) as Record<string, unknown>;
    expect(evidence.stream).toBe("assembly");
    expect(evidence.assembledKinds).toEqual(["system", "session"]);
    expect(evidence.droppedOptionalKinds).toEqual([
      "workspace_summary",
      "recent_transcript",
    ]);
    expect(evidence.orderApplied).toEqual(["system", "session"]);
    expect(evidence.totalTokens).toBe(30);
    expect(evidence.truncated).toBe(true);
    expect(evidence.preparedArtifactsUsed).toBe(1);
    expect(evidence.dropReason).toBe("budget exceeded");
  });

  it("emitAssemblyEvidence pushes through the sink", () => {
    const sink = new CapturingSink();
    emitAssemblyEvidence(sink, ANCHOR, {
      result: {
        assembled: [],
        totalTokens: 0,
        truncated: false,
        orderApplied: [],
      },
    });
    expect(sink.emitted).toHaveLength(1);
  });
});

describe("buildCompactEvidence", () => {
  it("encodes the request phase", () => {
    const request: ContextCompactRequestBody = {
      history_ref: { kind: "r2", key: "history.json" },
      target_token_budget: 4000,
    };
    const evidence = buildCompactEvidence(ANCHOR, {
      phase: "request",
      request,
    }) as Record<string, unknown>;
    expect(evidence.phase).toBe("request");
    expect(evidence.targetTokenBudget).toBe(4000);
    expect(evidence.historyRefKey).toBe("history.json");
  });

  it("encodes the response phase including error fields", () => {
    const response: ContextCompactResponseBody = {
      status: "error",
      tokens_before: 2000,
      tokens_after: 1500,
      error: { code: "compact-failed", message: "no summarizer" },
    };
    const evidence = buildCompactEvidence(ANCHOR, {
      phase: "response",
      response,
    }) as Record<string, unknown>;
    expect(evidence.phase).toBe("response");
    expect(evidence.tokensBefore).toBe(2000);
    expect(evidence.tokensAfter).toBe(1500);
    expect(evidence.errorCode).toBe("compact-failed");
    expect(evidence.errorMessage).toBe("no summarizer");
  });

  it("encodes the boundary phase", () => {
    const evidence = buildCompactEvidence(ANCHOR, {
      phase: "boundary",
      boundary: {
        turnRange: "0-12",
        summaryRef: { kind: "r2", key: "summary.json" } as never,
        archivedAt: "2026-04-18T10:00:00.000Z",
      },
    }) as Record<string, unknown>;
    expect(evidence.phase).toBe("boundary");
    expect(evidence.turnRange).toBe("0-12");
    expect(evidence.summaryRefKey).toBe("summary.json");
  });

  it("encodes the error phase as a stand-alone evidence", () => {
    const evidence = buildCompactEvidence(ANCHOR, {
      phase: "error",
      errorCode: "out-of-budget",
      errorMessage: "no budget left",
      targetTokenBudget: 1024,
    }) as Record<string, unknown>;
    expect(evidence.phase).toBe("error");
    expect(evidence.errorCode).toBe("out-of-budget");
  });

  it("emitCompactEvidence pushes records via sink", () => {
    const sink = new CapturingSink();
    emitCompactEvidence(sink, ANCHOR, {
      phase: "error",
      errorCode: "x",
      errorMessage: "y",
    });
    expect(sink.emitted).toHaveLength(1);
  });
});

describe("buildArtifactEvidence", () => {
  it("preserves every lifecycle stage field", () => {
    const evidence = buildArtifactEvidence(ANCHOR, {
      artifactName: "out.json",
      stage: "promoted",
      sizeBytes: 8192,
      contentType: "application/json",
      sourceRefKey: "src.json",
      preparedRefKey: "prepared.json",
      reason: "size > inline budget",
    }) as Record<string, unknown>;
    expect(evidence.stream).toBe("artifact");
    expect(evidence.stage).toBe("promoted");
    expect(evidence.preparedRefKey).toBe("prepared.json");
  });

  it("emitArtifactEvidence forwards records", () => {
    const sink = new CapturingSink();
    emitArtifactEvidence(sink, ANCHOR, {
      artifactName: "x.json",
      stage: "archived",
    });
    expect(sink.emitted).toHaveLength(1);
  });
});

describe("buildSnapshotEvidence", () => {
  const fragment = {
    version: "1.0.0",
    createdAt: "2026-04-18T10:00:00.000Z",
    mountConfigs: [
      { mountPoint: "/work", backend: "memory", access: "writable" } as never,
    ],
    fileIndex: [
      { path: "/work/a.txt" } as never,
      { path: "/work/b.txt" } as never,
    ],
    artifactRefs: [{ key: "out.json" } as never],
    contextLayers: [{ kind: "system" } as never],
  } as unknown as WorkspaceSnapshotFragment;

  it("emits capture phase with fragment counts", () => {
    const evidence = buildSnapshotEvidence(ANCHOR, {
      phase: "capture",
      fragment,
    }) as Record<string, unknown>;
    expect(evidence.phase).toBe("capture");
    expect(evidence.mountCount).toBe(1);
    expect(evidence.fileIndexCount).toBe(2);
    expect(evidence.artifactRefCount).toBe(1);
    expect(evidence.contextLayerCount).toBe(1);
  });

  it("emits restore phase with coverage + missing fragments", () => {
    const evidence = buildSnapshotEvidence(ANCHOR, {
      phase: "restore",
      fragment,
      restoreCoverage: 0.75,
      missingFragments: ["mounts/aux"],
    }) as Record<string, unknown>;
    expect(evidence.phase).toBe("restore");
    expect(evidence.restoreCoverage).toBe(0.75);
    expect(evidence.missingFragments).toEqual(["mounts/aux"]);
  });

  it("emitSnapshotEvidence forwards records", () => {
    const sink = new CapturingSink();
    emitSnapshotEvidence(sink, ANCHOR, { phase: "capture", fragment });
    expect(sink.emitted).toHaveLength(1);
  });
});
