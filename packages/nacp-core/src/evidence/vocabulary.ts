import { z } from "zod";

export const EvidenceAnchorSchema = z.object({
  traceUuid: z.string().uuid(),
  sessionUuid: z.string().uuid(),
  teamUuid: z.string().min(1).max(64),
  sourceRole: z.string().min(1).max(64),
  sourceKey: z.string().min(1).max(128).optional(),
  turnUuid: z.string().min(1).max(128).optional(),
  timestamp: z.string().datetime({ offset: true }),
});
export type EvidenceAnchor = z.infer<typeof EvidenceAnchorSchema>;

export const EvidenceStreamSchema = z.enum([
  "assembly",
  "compact",
  "artifact",
  "snapshot",
]);
export type EvidenceStream = z.infer<typeof EvidenceStreamSchema>;

export const AssemblyEvidenceRecordSchema = z.object({
  stream: z.literal("assembly"),
  anchor: EvidenceAnchorSchema,
  assembledKinds: z.array(z.string()),
  droppedOptionalKinds: z.array(z.string()),
  orderApplied: z.array(z.string()),
  totalTokens: z.number().int().min(0),
  truncated: z.boolean(),
  requiredLayerBudgetViolation: z.boolean().optional(),
  preparedArtifactsUsed: z.number().int().min(0).optional(),
  dropReason: z.string().optional(),
});
export type AssemblyEvidenceRecord = z.infer<typeof AssemblyEvidenceRecordSchema>;

export const CompactEvidencePhaseSchema = z.enum([
  "request",
  "response",
  "boundary",
  "error",
]);
export type CompactEvidencePhase = z.infer<typeof CompactEvidencePhaseSchema>;

export const CompactRequestEvidenceRecordSchema = z.object({
  stream: z.literal("compact"),
  anchor: EvidenceAnchorSchema,
  phase: z.literal("request"),
  targetTokenBudget: z.number().int().min(0),
  historyRefKey: z.string().min(1).optional(),
});

export const CompactResponseEvidenceRecordSchema = z.object({
  stream: z.literal("compact"),
  anchor: EvidenceAnchorSchema,
  phase: z.literal("response"),
  tokensBefore: z.number().int().min(0).optional(),
  tokensAfter: z.number().int().min(0).optional(),
  summaryRefKey: z.string().min(1).optional(),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
});

export const CompactBoundaryEvidenceRecordSchema = z.object({
  stream: z.literal("compact"),
  anchor: EvidenceAnchorSchema,
  phase: z.literal("boundary"),
  summaryRefKey: z.string().min(1).optional(),
  turnRange: z.string().min(1),
  archivedAt: z.string().datetime({ offset: true }),
});

export const CompactErrorEvidenceRecordSchema = z.object({
  stream: z.literal("compact"),
  anchor: EvidenceAnchorSchema,
  phase: z.literal("error"),
  targetTokenBudget: z.number().int().min(0).optional(),
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
});

export const CompactEvidenceRecordSchema = z.discriminatedUnion("phase", [
  CompactRequestEvidenceRecordSchema,
  CompactResponseEvidenceRecordSchema,
  CompactBoundaryEvidenceRecordSchema,
  CompactErrorEvidenceRecordSchema,
]);
export type CompactEvidenceRecord = z.infer<typeof CompactEvidenceRecordSchema>;

export const ArtifactLifecycleStageSchema = z.enum([
  "inline",
  "promoted",
  "prepared",
  "archived",
  "replaced",
]);
export type ArtifactLifecycleStage = z.infer<typeof ArtifactLifecycleStageSchema>;

export const ArtifactEvidenceRecordSchema = z.object({
  stream: z.literal("artifact"),
  anchor: EvidenceAnchorSchema,
  artifactName: z.string().min(1),
  stage: ArtifactLifecycleStageSchema,
  sizeBytes: z.number().int().min(0).optional(),
  contentType: z.string().min(1).optional(),
  sourceRefKey: z.string().min(1).optional(),
  preparedRefKey: z.string().min(1).optional(),
  archivedRefKey: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
});
export type ArtifactEvidenceRecord = z.infer<typeof ArtifactEvidenceRecordSchema>;

export const SnapshotCaptureEvidenceRecordSchema = z.object({
  stream: z.literal("snapshot"),
  anchor: EvidenceAnchorSchema,
  phase: z.literal("capture"),
  mountCount: z.number().int().min(0),
  fileIndexCount: z.number().int().min(0),
  artifactRefCount: z.number().int().min(0),
  contextLayerCount: z.number().int().min(0),
});

export const SnapshotRestoreEvidenceRecordSchema = z.object({
  stream: z.literal("snapshot"),
  anchor: EvidenceAnchorSchema,
  phase: z.literal("restore"),
  mountCount: z.number().int().min(0),
  fileIndexCount: z.number().int().min(0),
  artifactRefCount: z.number().int().min(0),
  contextLayerCount: z.number().int().min(0),
  restoreCoverage: z.number().min(0).max(1),
  missingFragments: z.array(z.string()).optional(),
});

export const SnapshotEvidenceRecordSchema = z.discriminatedUnion("phase", [
  SnapshotCaptureEvidenceRecordSchema,
  SnapshotRestoreEvidenceRecordSchema,
]);
export type SnapshotEvidenceRecord = z.infer<typeof SnapshotEvidenceRecordSchema>;

export const EvidenceRecordSchema = z.union([
  AssemblyEvidenceRecordSchema,
  CompactEvidenceRecordSchema,
  ArtifactEvidenceRecordSchema,
  SnapshotEvidenceRecordSchema,
]);
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
