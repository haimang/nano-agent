/**
 * Redaction — consume Core's redaction_hint to scrub sensitive fields
 * before pushing session.stream.event frames to client.
 */

export function redactPayload(
  payload: Record<string, unknown>,
  hints: string[],
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
