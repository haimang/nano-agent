/**
 * Attachment Planner
 *
 * Decides how a given attachment (identified by MIME type and size)
 * enters an LLM request. Routes are aligned with the action-plan's
 * worker-native delivery taxonomy:
 *
 *   - `inline`        : short text/JSON delivered inside the message body.
 *   - `signed-url`    : direct signed URL the model can fetch itself
 *                       (today: `image_url` content parts).
 *   - `proxy-url`     : URL proxied through a nano-agent worker (e.g. when
 *                       the underlying storage requires gated access).
 *                       Not emitted by the default planner yet, but kept
 *                       in the enum so callers wiring staged delivery
 *                       do not invent a new route name.
 *   - `prepared-text` : document types that require upstream extraction
 *                       (PDF/DOCX/XLSX/PPTX/RTF or oversized text).
 *   - `reject`        : MIME/size not supported (model has no capability
 *                       or file is outside the attachment contract).
 */

import type { ModelCapabilities } from "./registry/models.js";

/**
 * The 5 v1 attachment routes. Worker-native names map to how the content
 * actually reaches the model, not how it is encoded in the adapter JSON.
 */
export type AttachmentRoute =
  | "inline"
  | "signed-url"
  | "proxy-url"
  | "prepared-text"
  | "reject";

/**
 * Legacy route aliases (prior to 2026-04-17 route rename). The planner
 * never returns these any more; they are re-exported so callers that
 * were built against the old API can migrate gracefully.
 *
 * Mapping:
 *   "inline-text" → "inline"
 *   "image-url"   → "signed-url"
 */
export type LegacyAttachmentRoute = "inline-text" | "image-url";

export interface AttachmentPlan {
  readonly route: AttachmentRoute;
  readonly mimeType: string;
  readonly reason: string;
}

/** Maximum size for inline text attachments (100 KB). */
const INLINE_TEXT_MAX_BYTES = 100 * 1024;

/** MIME types that are routed to prepared-text extraction. */
const PREPARED_TEXT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf",
]);

/** All MIME types this planner can handle. */
export const SUPPORTED_MIME_TYPES: ReadonlySet<string> = new Set([
  // Text types
  "text/plain",
  "text/markdown",
  "text/html",
  "text/csv",
  "text/xml",
  "application/json",
  "application/xml",
  // Image types
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  // Document types (prepared-text)
  ...PREPARED_TEXT_TYPES,
]);

/**
 * Plan how an attachment should be routed into the LLM request.
 *
 * Routing rules (v1):
 *   1. image/* + vision support          → signed-url
 *   2. image/* without vision            → reject
 *   3. PDF / Office docs                 → prepared-text
 *   4. text/* or json/xml ≤ inline cap   → inline
 *   5. text/* or json/xml > inline cap   → prepared-text
 *   6. anything else                     → reject
 *
 * A future wiring layer may upgrade signed-url → proxy-url when the
 * storage binding requires gated access; the planner purposefully keeps
 * proxy-url in the enum so that decision is made without renaming routes.
 */
export function planAttachment(
  mimeType: string,
  sizeBytes: number,
  modelCaps: ModelCapabilities,
): AttachmentPlan {
  // Image handling
  if (mimeType.startsWith("image/")) {
    if (modelCaps.supportsVision) {
      return {
        route: "signed-url",
        mimeType,
        reason: "Image attachment routed as signed URL (model supports vision)",
      };
    }
    return {
      route: "reject",
      mimeType,
      reason: `Model "${modelCaps.modelId}" does not support vision; cannot process image`,
    };
  }

  // Document types requiring extraction
  if (PREPARED_TEXT_TYPES.has(mimeType)) {
    return {
      route: "prepared-text",
      mimeType,
      reason: `Document type "${mimeType}" requires text extraction`,
    };
  }

  // Text-like types
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml"
  ) {
    if (sizeBytes <= INLINE_TEXT_MAX_BYTES) {
      return {
        route: "inline",
        mimeType,
        reason: "Text attachment inlined directly (within size limit)",
      };
    }
    return {
      route: "prepared-text",
      mimeType,
      reason: `Text attachment too large for inline (${sizeBytes} bytes > ${INLINE_TEXT_MAX_BYTES}); requires extraction/summarization`,
    };
  }

  // Unsupported
  return {
    route: "reject",
    mimeType,
    reason: `MIME type "${mimeType}" is not supported for LLM attachment`,
  };
}
