/**
 * Prepared Artifact Reference
 *
 * Structurally compatible with
 * `@nano-agent/workspace-context-artifacts`'s
 * `PreparedArtifactRefSchema`, which is in turn aligned with
 * `@nano-agent/nacp-core`'s `NacpRefSchema`:
 *
 *   { kind:        "r2" | "kv" | "do-storage" | "d1" | "queue-dlq",
 *     binding,
 *     team_uuid,
 *     key:         tenants/{team_uuid}/…,
 *     role:        "input" | "output" | "attachment",
 *     content_type?, size_bytes?, etag?, bucket?,
 *     artifactKind: "file" | "image" | "document" |
 *                   "export" | "compact-archive" | "transcript",
 *     createdAt,
 *     preparedKind: "extracted-text" | "summary" | "preview",
 *     sourceRef:    ArtifactRefLike }
 *
 * We intentionally avoid importing the workspace package directly so
 * the wrapper doesn't pull a new peer dep; the shape MUST stay aligned
 * and is guarded by the `prepared-artifact-routing` integration test.
 *
 * For callers that only care about the extracted text delivered to the
 * LLM (not workspace storage metadata), the `textContent` field
 * remains available but is NOT part of the workspace schema — it is a
 * wrapper-side convenience. Consumers producing values for
 * `PreparedArtifactRefSchema` must strip `textContent` before parsing
 * (use `toWorkspacePreparedArtifactRef()`).
 */

/**
 * Artifact reference metadata. Mirrors workspace `ArtifactRef` one-for-one.
 */
export interface ArtifactRefLike {
  readonly kind: "r2" | "kv" | "do-storage" | "d1" | "queue-dlq";
  readonly binding: string;
  readonly team_uuid: string;
  readonly key: string;
  readonly role: "input" | "output" | "attachment";
  readonly content_type?: string;
  readonly size_bytes?: number;
  readonly etag?: string;
  readonly bucket?: string;
  readonly artifactKind:
    | "file"
    | "image"
    | "document"
    | "export"
    | "compact-archive"
    | "transcript";
  readonly createdAt: string;
}

/**
 * Prepared artifact reference produced after extracting text, summary
 * or preview content from a source artifact.
 */
export interface PreparedArtifactRef extends ArtifactRefLike {
  readonly preparedKind: "extracted-text" | "summary" | "preview";
  readonly sourceRef: ArtifactRefLike;
  /**
   * Wrapper-side convenience: the extracted text itself when it fits
   * under the attachment-planner's inline budget. Downstream consumers
   * producing values for the workspace schema must strip this field.
   */
  readonly textContent?: string;
}

/**
 * Strip the wrapper-only `textContent` field so the remaining object
 * parses cleanly under `PreparedArtifactRefSchema`.
 */
export function toWorkspacePreparedArtifactRef(
  ref: PreparedArtifactRef,
): Omit<PreparedArtifactRef, "textContent"> {
  const { textContent: _textContent, ...rest } = ref;
  return rest;
}
