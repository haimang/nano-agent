/**
 * Workspace runtime composition (2nd-round R2 / A6-A7 GPT R4 closure).
 *
 * `workspace-context-artifacts` already provides three business
 * objects (`ContextAssembler`, `CompactBoundaryManager`,
 * `WorkspaceSnapshotBuilder`) with optional `{ evidenceSink,
 * evidenceAnchor }` wiring. Until this module landed, the DO never
 * created any of those instances at runtime — so the emitters never
 * fired in production, only in unit tests.
 *
 * `composeWorkspaceWithEvidence()` is the runtime use-site GPT R2
 * asked for: a single helper that the DO calls to construct the
 * trio with `evidenceSink` (typically the eval sink emit method)
 * and a thunk-style `evidenceAnchor` (typically the DO's per-call
 * `EvidenceAnchor` builder). The handle it returns becomes
 * `subsystems.workspace`, so any later `persistCheckpoint` or
 * `assemble` call automatically emits evidence into the live sink.
 */

import {
  ContextAssembler,
  CompactBoundaryManager,
  WorkspaceSnapshotBuilder,
  type ArtifactStore,
  type ContextAssemblyConfig,
  type EvidenceAnchorLike,
  type EvidenceSinkLike,
  type WorkspaceNamespace,
  type WorkspaceSnapshotFragment,
} from "@nano-agent/workspace-context-artifacts";

export interface WorkspaceCompositionHandle {
  readonly assembler: ContextAssembler;
  readonly compactManager: CompactBoundaryManager;
  readonly snapshotBuilder: WorkspaceSnapshotBuilder;
  /**
   * Convenience wrapper around
   * `WorkspaceSnapshotBuilder.buildFragment()` that simply discards
   * the fragment after returning it. The caller's intent is "fire a
   * `snapshot.capture` evidence record" (see `NanoSessionDO.persistCheckpoint`).
   */
  readonly captureSnapshot: () => Promise<WorkspaceSnapshotFragment>;
}

export interface ComposeWorkspaceWithEvidenceOptions {
  readonly namespace: WorkspaceNamespace;
  readonly artifactStore: ArtifactStore;
  /** Defaults match `ContextAssembler` defaults; supply for richer planners. */
  readonly assemblerConfig?: ContextAssemblyConfig;
  /**
   * Sink fed by every `assembly / compact / snapshot` evidence
   * record. Pass the same `eval.emit` reference the DO already uses
   * for trace events so a single sink ingests both streams.
   */
  readonly evidenceSink?: EvidenceSinkLike;
  /**
   * Per-call anchor builder. Returns `undefined` when no trace
   * identity is yet latched (e.g. cold start before the first WS
   * frame); the helpers gracefully suppress emission in that window.
   */
  readonly evidenceAnchor?: () => EvidenceAnchorLike | undefined;
}

const DEFAULT_ASSEMBLER_CONFIG: ContextAssemblyConfig = {
  // Conservative defaults so the DO can construct a workspace
  // bundle even before its real LLM budgets are wired. Real
  // composition factories override `assemblerConfig` in production.
  maxTokens: 32_000,
  reserveForResponse: 1_024,
  // Empty `layers` lets `ContextAssembler` fall back to the
  // canonical layer order (`CANONICAL_LAYER_ORDER`).
  layers: [],
};

export function composeWorkspaceWithEvidence(
  options: ComposeWorkspaceWithEvidenceOptions,
): WorkspaceCompositionHandle {
  const evidenceWiring =
    options.evidenceSink && options.evidenceAnchor
      ? {
          evidenceSink: options.evidenceSink,
          evidenceAnchor: options.evidenceAnchor,
        }
      : {};
  const assembler = new ContextAssembler(
    options.assemblerConfig ?? DEFAULT_ASSEMBLER_CONFIG,
    evidenceWiring,
  );
  const compactManager = new CompactBoundaryManager(evidenceWiring);
  const snapshotBuilder = new WorkspaceSnapshotBuilder(
    options.namespace,
    options.artifactStore,
    evidenceWiring,
  );
  return {
    assembler,
    compactManager,
    snapshotBuilder,
    captureSnapshot: () => snapshotBuilder.buildFragment(),
  };
}
