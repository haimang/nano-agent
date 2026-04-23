/**
 * A6-A7 review R4 / Kimi R3 — evidence emitters hit the real runtime
 * paths.
 *
 * Previously the `emit*Evidence` helpers were only invoked by unit
 * tests; the business objects themselves (`ContextAssembler`,
 * `CompactBoundaryManager`, `WorkspaceSnapshotBuilder`) never reached
 * for a sink. This integration test exercises each of the three
 * object's main method and asserts the sink received the right
 * `stream` + shape. Without these emissions the P6 verdict pipeline
 * would remain a synthetic-only loop.
 */

import { describe, it, expect } from "vitest";
import { ContextAssembler } from "../../src/context-assembler.js";
import type { ContextLayer } from "../../src/context-layers.js";
import { CompactBoundaryManager } from "../../src/compact-boundary.js";
import type { ArtifactRef } from "../../src/refs.js";
import type { ContextCompactResponseBody } from "../../src/compact-boundary.js";
import { WorkspaceSnapshotBuilder } from "../../src/snapshot.js";
import type { WorkspaceNamespace } from "../../src/namespace.js";
import type { ArtifactStore, ArtifactStoreMeta } from "../../src/artifacts.js";
import type {
  EvidenceAnchorLike,
  EvidenceSinkLike,
} from "../../src/evidence-emitters.js";

const ANCHOR: EvidenceAnchorLike = {
  traceUuid: "11111111-1111-4111-8111-111111111111",
  sessionUuid: "22222222-2222-4222-8222-222222222222",
  teamUuid: "team-r4",
  sourceRole: "session",
  sourceKey: "nano-agent.session.do@v1",
  timestamp: "2026-04-18T12:00:00.000Z",
};

function makeSink(): {
  sink: EvidenceSinkLike;
  emitted: unknown[];
} {
  const emitted: unknown[] = [];
  return {
    emitted,
    sink: {
      emit(record) {
        emitted.push(record);
      },
    },
  };
}

describe("A6-A7 review R4 — runtime emitters (ContextAssembler)", () => {
  it("emits an `assembly` evidence record on every assemble()", () => {
    const { sink, emitted } = makeSink();
    const assembler = new ContextAssembler(
      { maxTokens: 100, reserveForResponse: 10 },
      { evidenceSink: sink, evidenceAnchor: () => ANCHOR },
    );
    const layers: ContextLayer[] = [
      { kind: "system", priority: 0, tokenEstimate: 20, required: true, content: "" },
      { kind: "session", priority: 0, tokenEstimate: 30, required: false, content: "" },
    ];
    const result = assembler.assemble(layers);
    expect(result.assembled).toHaveLength(2);
    expect(emitted).toHaveLength(1);
    const rec = emitted[0] as { stream: string; assembledKinds: string[]; orderApplied: string[] };
    expect(rec.stream).toBe("assembly");
    expect(rec.assembledKinds).toContain("system");
    expect(rec.assembledKinds).toContain("session");
    expect(rec.orderApplied.length).toBeGreaterThan(0);
  });

  it("does not emit when no anchor is available (trace not yet latched)", () => {
    const { sink, emitted } = makeSink();
    const assembler = new ContextAssembler(
      { maxTokens: 100, reserveForResponse: 10 },
      { evidenceSink: sink, evidenceAnchor: () => undefined },
    );
    assembler.assemble([]);
    expect(emitted).toHaveLength(0);
  });

  it("late-binds wiring via setEvidenceWiring()", () => {
    const { sink, emitted } = makeSink();
    const assembler = new ContextAssembler({ maxTokens: 100, reserveForResponse: 10 });
    assembler.assemble([]); // no wiring yet → no emission
    assembler.setEvidenceWiring({ evidenceSink: sink, evidenceAnchor: () => ANCHOR });
    assembler.assemble([]);
    expect(emitted).toHaveLength(1);
  });
});

describe("A6-A7 review R4 — runtime emitters (CompactBoundaryManager)", () => {
  const summaryRef: ArtifactRef = {
    kind: "artifact",
    key: "tenants/team-r4/artifacts/sess-1/summary.txt",
    size_bytes: 100,
    content_type: "text/plain",
  };

  it("emits request/response/boundary in sequence on a happy-path apply", () => {
    const { sink, emitted } = makeSink();
    const manager = new CompactBoundaryManager({
      evidenceSink: sink,
      evidenceAnchor: () => ANCHOR,
    });
    manager.buildCompactRequest({
      historyRef: summaryRef,
      targetTokenBudget: 500,
    });
    const response: ContextCompactResponseBody = {
      status: "ok",
      tokens_before: 1000,
      tokens_after: 400,
      summary_ref: summaryRef,
    };
    const applied = manager.applyCompactResponse([], response, summaryRef, "turns 1-5");
    expect("error" in applied).toBe(false);
    const phases = emitted.map((r) => (r as { phase: string }).phase);
    expect(phases).toEqual(["request", "response", "boundary"]);
    for (const rec of emitted) {
      expect((rec as { stream: string }).stream).toBe("compact");
    }
  });

  it("emits compact.error when response.status === 'error'", () => {
    const { sink, emitted } = makeSink();
    const manager = new CompactBoundaryManager({
      evidenceSink: sink,
      evidenceAnchor: () => ANCHOR,
    });
    manager.buildCompactRequest({
      historyRef: summaryRef,
      targetTokenBudget: 500,
    });
    const response: ContextCompactResponseBody = {
      status: "error",
      error: { code: "budget-too-small", message: "budget below floor" },
    };
    manager.applyCompactResponse([], response, summaryRef, "turns 1-5");
    const phases = emitted.map((r) => (r as { phase: string }).phase);
    // request + response + error (no boundary because of error branch)
    expect(phases).toEqual(["request", "response", "error"]);
  });
});

describe("A6-A7 review R4 — runtime emitters (WorkspaceSnapshotBuilder)", () => {
  const fakeNamespace = {
    listMounts() {
      return [];
    },
    async listDir() {
      return [];
    },
  } as unknown as WorkspaceNamespace;
  const fakeArtifactStore: ArtifactStore = {
    list(): ArtifactStoreMeta[] {
      return [];
    },
    save: async () => ({} as never),
    get: async () => undefined,
  } as unknown as ArtifactStore;

  it("emits a snapshot.capture record every time buildFragment() runs", async () => {
    const { sink, emitted } = makeSink();
    const builder = new WorkspaceSnapshotBuilder(fakeNamespace, fakeArtifactStore, {
      evidenceSink: sink,
      evidenceAnchor: () => ANCHOR,
    });
    const frag = await builder.buildFragment();
    expect(emitted).toHaveLength(1);
    const rec = emitted[0] as { stream: string; phase: string };
    expect(rec.stream).toBe("snapshot");
    expect(rec.phase).toBe("capture");
    expect(frag.version).toBeDefined();
  });

  it("emitRestoreEvidence publishes a snapshot.restore record with coverage", async () => {
    const { sink, emitted } = makeSink();
    const builder = new WorkspaceSnapshotBuilder(fakeNamespace, fakeArtifactStore, {
      evidenceSink: sink,
      evidenceAnchor: () => ANCHOR,
    });
    const frag = await builder.buildFragment();
    builder.emitRestoreEvidence(frag, 0.75, ["contextLayer:injected"]);
    const restore = emitted.find((r) => (r as { phase?: string }).phase === "restore");
    expect(restore).toBeDefined();
    expect((restore as { restoreCoverage?: number }).restoreCoverage).toBe(0.75);
  });
});
