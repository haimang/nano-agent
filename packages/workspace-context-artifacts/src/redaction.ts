/**
 * Workspace Context Artifacts — Preview / Redaction Helpers
 *
 * Provides utilities for building client-safe previews of artifacts,
 * reducing internal-only artifacts to ref-only stubs, and applying
 * `redaction_hint`-driven payload scrubbing consistent with
 * `@haimang/nacp-session`'s `redactPayload()`.
 *
 * The `redactPayload()` truth is re-implemented locally (kept in
 * lock-step with Session by the integration test) so this package
 * does not take a hard dependency on nacp-session at install time.
 * Downstream callers that already import from nacp-session can pass
 * its `redactPayload` directly via the optional `payloadRedactor`
 * argument on `redactForClient()` / `redactArtifactPayload()`.
 */

import type { ArtifactMetadata } from "./artifacts.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — redactPayload (local mirror of nacp-session)
// ═══════════════════════════════════════════════════════════════════

/**
 * Consume `redaction_hint`-style paths and scrub sensitive fields
 * before a payload leaves this process. Same behaviour as
 * `@haimang/nacp-session`'s `redactPayload()` — the integration
 * test pins the two in lock-step.
 */
export function redactPayload(
  payload: Record<string, unknown>,
  hints: readonly string[],
): Record<string, unknown> {
  if (!hints || hints.length === 0) return payload;
  const result = structuredClone(payload);
  for (const path of hints) {
    setNestedValue(result, path, "[redacted]");
  }
  return result;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (typeof cursor[k] !== "object" || cursor[k] === null) return;
    cursor = cursor[k] as Record<string, unknown>;
  }
  const lastKey = keys[keys.length - 1]!;
  if (lastKey in cursor) {
    cursor[lastKey] = value;
  }
}

/**
 * Optional external redactor the caller can inject (e.g. nacp-session's
 * `redactPayload`). Same signature as the local version so
 * implementations are swappable.
 */
export type PayloadRedactor = (
  payload: Record<string, unknown>,
  hints: readonly string[],
) => Record<string, unknown>;

// ═══════════════════════════════════════════════════════════════════
// §2 — redactForClient
// ═══════════════════════════════════════════════════════════════════

/**
 * Determine what a client should see for a given artifact.
 *
 *  - `client-visible` artifacts return their preview text (if any).
 *  - `internal` artifacts are reduced to ref-only (no content exposed).
 *
 * When `redactionHints` are provided, JSON-shaped previews are
 * scrubbed through `redactPayload()` before being returned. Plain-text
 * previews are passed through untouched because redaction-hint paths
 * only make sense for structured payloads.
 */
export function redactForClient(
  artifact: ArtifactMetadata,
  options: {
    readonly redactionHints?: readonly string[];
    readonly payloadRedactor?: PayloadRedactor;
  } = {},
): { previewText?: string; refOnly: boolean } {
  if (artifact.audience === "internal") {
    return { refOnly: true };
  }

  const preview = artifact.previewText;
  if (!preview) {
    return { refOnly: true };
  }

  if (!options.redactionHints || options.redactionHints.length === 0) {
    return { previewText: preview, refOnly: false };
  }

  const redactor = options.payloadRedactor ?? redactPayload;
  const scrubbed = scrubPreview(preview, options.redactionHints, redactor);
  return { previewText: scrubbed, refOnly: false };
}

function scrubPreview(
  preview: string,
  hints: readonly string[],
  redactor: PayloadRedactor,
): string {
  // Only attempt structured redaction when the preview looks like JSON;
  // otherwise return as-is so a plain-text preview is never corrupted.
  const trimmed = preview.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return preview;
  try {
    const parsed = JSON.parse(preview) as unknown;
    if (parsed === null || typeof parsed !== "object") return preview;
    const scrubbed = redactor(parsed as Record<string, unknown>, hints);
    return JSON.stringify(scrubbed);
  } catch {
    return preview;
  }
}

// ═══════════════════════════════════════════════════════════════════
// §3 — buildPreview
// ═══════════════════════════════════════════════════════════════════

/**
 * Truncate content to a maximum length for preview display.
 * Appends "..." when content is truncated.
 */
export function buildPreview(content: string, maxLength: number = 200): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(0, maxLength) + "...";
}

// ═══════════════════════════════════════════════════════════════════
// §4 — redactArtifactPayload (full-payload convenience)
// ═══════════════════════════════════════════════════════════════════

/**
 * Apply `redactPayload()` to an arbitrary artifact-side payload. Thin
 * wrapper so callers don't need to care whether they got the payload
 * redactor from `@haimang/nacp-session` or from this package.
 */
export function redactArtifactPayload(
  payload: Record<string, unknown>,
  hints: readonly string[],
  payloadRedactor: PayloadRedactor = redactPayload,
): Record<string, unknown> {
  return payloadRedactor(payload, hints);
}
