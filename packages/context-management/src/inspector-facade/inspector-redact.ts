/**
 * Context-Management — inspector-facade redact filter.
 *
 * The inspector facade MUST never leak secrets — API keys, bearer
 * tokens, OAuth refresh tokens, anything that looks like credentials.
 * This module provides:
 *
 *   - `redactSecrets(text)`     — string scrub used by `LayerView.preview`
 *   - `redactPayload(obj)`      — object scrub used by `UsageReport`
 *                                 inputs (recursive on string fields)
 *
 * The redactor is intentionally **conservative** — it prefers false
 * positives (overzealous redaction) to false negatives (leaked
 * secret). Patterns are easy to extend; if a real workload trips a
 * legitimate value, the `safeKeys` allow-list lets the caller exempt
 * known field names.
 */

const SECRET_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  // Anthropic-style key
  { name: "anthropic-api-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  // Generic provider key
  { name: "generic-api-key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  // OpenAI legacy
  { name: "openai-key", pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  // GitHub PAT
  { name: "github-pat", pattern: /\bghp_[A-Za-z0-9]{20,}\b/g },
  // AWS access key id
  { name: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  // Bearer token in header form
  { name: "bearer-header", pattern: /\b[Bb]earer\s+[A-Za-z0-9._-]{12,}\b/g },
  // JWT
  { name: "jwt", pattern: /\b[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g },
];

const SECRET_KEY_NAME_RE = /(api_?key|secret|token|password|passwd|credential|access_?key)/i;

export interface RedactOptions {
  /** Field names whose value is preserved verbatim (e.g. `["sessionUuid"]`). */
  readonly safeKeys?: ReadonlyArray<string>;
}

/** Scrub secrets out of a free-form string. */
export function redactSecrets(input: string): string {
  let out = input;
  for (const { pattern } of SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}

/**
 * Recursively redact secrets in an arbitrary JSON-shaped object.
 *
 *   - String values are scrubbed via `redactSecrets`.
 *   - Object keys whose name matches `SECRET_KEY_NAME_RE` get their
 *     entire value replaced with `[redacted]`, regardless of type.
 *   - Arrays / nested objects are walked recursively.
 *   - Cyclic refs are broken with `[cyclic]`.
 *
 * `safeKeys` exempts specific field names from both rules.
 */
export function redactPayload<T = unknown>(value: T, options: RedactOptions = {}): T {
  const safe = new Set(options.safeKeys ?? []);
  const seen = new WeakSet<object>();
  const walk = (node: unknown): unknown => {
    if (node === null || node === undefined) return node;
    if (typeof node === "string") return redactSecrets(node);
    if (typeof node !== "object") return node;
    if (seen.has(node as object)) return "[cyclic]";
    seen.add(node as object);
    if (Array.isArray(node)) return node.map(walk);
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(node as Record<string, unknown>)) {
      if (safe.has(key)) {
        out[key] = raw;
        continue;
      }
      if (SECRET_KEY_NAME_RE.test(key)) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = walk(raw);
    }
    return out;
  };
  return walk(value) as T;
}
