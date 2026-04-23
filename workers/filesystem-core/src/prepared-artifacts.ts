/**
 * Workspace Context Artifacts — Prepared Artifact Pipeline
 *
 * Contract for artifact preparation (extracting text, generating
 * summaries or previews from raw artifacts). Includes a stub
 * implementation for testing.
 */

import type { ArtifactRef, PreparedArtifactKind, PreparedArtifactRef } from "./refs.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Prepare Request
// ═══════════════════════════════════════════════════════════════════

export interface PrepareRequest {
  readonly sourceRef: ArtifactRef;
  readonly targetKind: PreparedArtifactKind;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — Prepare Result
// ═══════════════════════════════════════════════════════════════════

export interface PrepareResult {
  readonly success: boolean;
  readonly preparedRef?: PreparedArtifactRef;
  readonly error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// §3 — Artifact Preparer Interface
// ═══════════════════════════════════════════════════════════════════

export interface ArtifactPreparer {
  prepare(request: PrepareRequest): Promise<PrepareResult>;
}

// ═══════════════════════════════════════════════════════════════════
// §4 — Stub Artifact Preparer
// ═══════════════════════════════════════════════════════════════════

/**
 * Returns a fake prepared result for testing. The prepared ref
 * inherits all fields from the source ref, adding the prepared
 * kind and a synthetic key.
 */
export class StubArtifactPreparer implements ArtifactPreparer {
  async prepare(request: PrepareRequest): Promise<PrepareResult> {
    const preparedRef: PreparedArtifactRef = {
      ...request.sourceRef,
      key: `${request.sourceRef.key}__${request.targetKind}`,
      preparedKind: request.targetKind,
      sourceRef: request.sourceRef,
    };

    return {
      success: true,
      preparedRef,
    };
  }
}
