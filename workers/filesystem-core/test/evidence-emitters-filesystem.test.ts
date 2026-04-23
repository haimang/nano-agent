import { describe, expect, it } from "vitest";
import { ArtifactEvidenceRecordSchema } from "@haimang/nacp-core";
import {
  buildArtifactEvidence,
  emitArtifactEvidence,
  type EvidenceAnchorLike,
  type EvidenceSinkLike,
} from "../src/evidence-emitters-filesystem.js";

const ANCHOR: EvidenceAnchorLike = {
  traceUuid: "11111111-1111-4111-8111-111111111111",
  sessionUuid: "22222222-2222-4222-8222-222222222222",
  teamUuid: "team-evidence",
  sourceRole: "filesystem",
  sourceKey: "nano-agent.filesystem.core@v1",
  timestamp: "2026-04-23T12:00:00.000Z",
};

class CapturingSink implements EvidenceSinkLike {
  readonly emitted: unknown[] = [];

  emit(record: unknown): void {
    this.emitted.push(record);
  }
}

describe("filesystem artifact evidence emitters", () => {
  it("buildArtifactEvidence preserves lifecycle fields and matches nacp-core schema", () => {
    const record = buildArtifactEvidence(ANCHOR, {
      artifactName: "bundle.json",
      stage: "promoted",
      sizeBytes: 8192,
      contentType: "application/json",
      sourceRefKey: "artifacts/input.json",
      preparedRefKey: "artifacts/prepared.json",
      archivedRefKey: "artifacts/archive.json",
      reason: "size > inline budget",
    });

    expect(record.stream).toBe("artifact");
    expect(record.stage).toBe("promoted");
    expect(record.preparedRefKey).toBe("artifacts/prepared.json");
    expect(ArtifactEvidenceRecordSchema.safeParse(record).success).toBe(true);
  });

  it("emitArtifactEvidence forwards the built record to the sink", () => {
    const sink = new CapturingSink();
    emitArtifactEvidence(sink, ANCHOR, {
      artifactName: "bundle.json",
      stage: "archived",
    });

    expect(sink.emitted).toHaveLength(1);
    expect(
      ArtifactEvidenceRecordSchema.safeParse(sink.emitted[0]).success,
    ).toBe(true);
  });
});
