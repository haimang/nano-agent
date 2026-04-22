import { describe, expect, it } from "vitest";
import {
  AssemblyEvidenceRecordSchema,
  ArtifactEvidenceRecordSchema,
  CompactEvidenceRecordSchema,
  EvidenceRecordSchema,
  SnapshotEvidenceRecordSchema,
  extractMessageUuid,
} from "../src/index.js";

const ANCHOR = {
  traceUuid: "11111111-1111-4111-8111-111111111111",
  sessionUuid: "22222222-2222-4222-8222-222222222222",
  teamUuid: "team-evidence",
  sourceRole: "session",
  sourceKey: "nano-agent.session.do@v1",
  timestamp: "2026-04-18T10:00:00.000Z",
};

describe("extractMessageUuid", () => {
  it("extracts direct, snake_case, and nested envelope/header forms", () => {
    expect(extractMessageUuid({ messageUuid: "abc" })).toBe("abc");
    expect(extractMessageUuid({ message_uuid: "def" })).toBe("def");
    expect(
      extractMessageUuid({ envelope: { header: { message_uuid: "ghi" } } }),
    ).toBe("ghi");
    expect(extractMessageUuid({ header: { message_uuid: "jkl" } })).toBe("jkl");
  });

  it("returns undefined for unmatched shapes", () => {
    expect(extractMessageUuid(null)).toBeUndefined();
    expect(extractMessageUuid({ messageUuid: "" })).toBeUndefined();
    expect(extractMessageUuid({})).toBeUndefined();
  });
});

describe("evidence record schemas", () => {
  it("parses assembly evidence", () => {
    const record = {
      stream: "assembly",
      anchor: ANCHOR,
      assembledKinds: ["system", "session"],
      droppedOptionalKinds: ["workspace_summary"],
      orderApplied: ["system", "session"],
      totalTokens: 30,
      truncated: true,
      preparedArtifactsUsed: 1,
      dropReason: "budget exceeded",
    };
    expect(AssemblyEvidenceRecordSchema.safeParse(record).success).toBe(true);
    expect(EvidenceRecordSchema.safeParse(record).success).toBe(true);
  });

  it("parses all compact evidence phases", () => {
    const records = [
      {
        stream: "compact",
        anchor: ANCHOR,
        phase: "request",
        targetTokenBudget: 4000,
        historyRefKey: "history.json",
      },
      {
        stream: "compact",
        anchor: ANCHOR,
        phase: "response",
        tokensBefore: 2000,
        tokensAfter: 1500,
        summaryRefKey: "summary.json",
        errorCode: "compact-failed",
        errorMessage: "no summarizer",
      },
      {
        stream: "compact",
        anchor: ANCHOR,
        phase: "boundary",
        summaryRefKey: "summary.json",
        turnRange: "0-12",
        archivedAt: "2026-04-18T10:00:00.000Z",
      },
      {
        stream: "compact",
        anchor: ANCHOR,
        phase: "error",
        targetTokenBudget: 1024,
        errorCode: "out-of-budget",
        errorMessage: "no budget left",
      },
    ];
    for (const record of records) {
      expect(CompactEvidenceRecordSchema.safeParse(record).success).toBe(true);
      expect(EvidenceRecordSchema.safeParse(record).success).toBe(true);
    }
  });

  it("parses artifact evidence", () => {
    const record = {
      stream: "artifact",
      anchor: ANCHOR,
      artifactName: "out.json",
      stage: "promoted",
      sizeBytes: 8192,
      contentType: "application/json",
      sourceRefKey: "src.json",
      preparedRefKey: "prepared.json",
      reason: "size > inline budget",
    };
    expect(ArtifactEvidenceRecordSchema.safeParse(record).success).toBe(true);
    expect(EvidenceRecordSchema.safeParse(record).success).toBe(true);
  });

  it("parses snapshot capture and restore evidence", () => {
    const capture = {
      stream: "snapshot",
      anchor: ANCHOR,
      phase: "capture",
      mountCount: 1,
      fileIndexCount: 2,
      artifactRefCount: 1,
      contextLayerCount: 1,
    };
    const restore = {
      ...capture,
      phase: "restore",
      restoreCoverage: 0.75,
      missingFragments: ["mounts/aux"],
    };
    expect(SnapshotEvidenceRecordSchema.safeParse(capture).success).toBe(true);
    expect(SnapshotEvidenceRecordSchema.safeParse(restore).success).toBe(true);
    expect(EvidenceRecordSchema.safeParse(capture).success).toBe(true);
    expect(EvidenceRecordSchema.safeParse(restore).success).toBe(true);
  });
});
