/**
 * NACP Version Migration Helpers.
 *
 * `migrate_v1_0_to_v1_1` absorbs the Phase 0 identifier-law rename:
 *   - `trace.trace_id`          → `trace.trace_uuid`
 *   - `trace.stream_id`         → `trace.stream_uuid`
 *   - `trace.span_id`           → `trace.span_uuid`
 *   - `header.producer_id`      → `header.producer_key`
 *   - `header.consumer_hint`    → `header.consumer_key`
 *   - `authority.stamped_by`    → `authority.stamped_by_key`
 *   - `control.reply_to`        → `control.reply_to_message_uuid`
 *   - (session frame) `session_frame.stream_id` → `session_frame.stream_uuid`
 *   - (session ack body) `body.stream_id` → `body.stream_uuid`
 *
 * Retired aliases are accepted on INPUT only and are rewritten into canonical
 * names before the schema parses. Writers always emit canonical names.
 *
 * Pattern mirrors `context/smcp/src/compat/migrations.ts`: migrations accept a
 * raw dict, return a raw dict, and never touch typed schemas.
 */

export function migrate_noop(raw: unknown): unknown {
  return raw;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Single-level rename. Only operates on the direct keys of `obj`; does not
 * recurse into nested objects or arrays. This is intentional — the identifier
 * law fixes the set of canonical sections the envelope publishes, so
 * legacy aliases only live at the top of the targeted section.
 *
 * Callers that need to migrate a deeper field MUST pass the nested object
 * explicitly (see `migrate_v1_0_to_v1_1` for the session-ack body case).
 */
function rename(obj: Record<string, unknown>, from: string, to: string): void {
  if (from in obj && !(to in obj)) {
    obj[to] = obj[from];
    delete obj[from];
  } else if (from in obj && to in obj) {
    // Both present: canonical wins, drop the legacy alias.
    delete obj[from];
  }
}

/**
 * Migrate a raw v1.0 payload into a v1.1-shaped raw payload.
 *
 * Accepts NACP envelope dicts, Session frame dicts (they extend envelope),
 * and bare session-body dicts that carry a legacy `stream_id` key (used by
 * `session.stream.ack`). Structures that don't match these shapes are
 * returned untouched — the migration is best-effort on the wire surface.
 *
 * Scope (Kimi R2, A1 review): this migration only renames the Phase 0
 * identifier-law aliases on the TOP-LEVEL envelope sections —
 * `header.*`, `authority.*`, `trace.*`, `control.*`, `session_frame.*`,
 * and the one special case `body.stream_id` when
 * `header.message_type === "session.stream.ack"`. Deeply nested legacy
 * fields inside `body`, `extra`, or `refs[]` are NOT traversed. The
 * clone is also a shallow spread — nested arrays/objects are shared with
 * the input reference, so callers that need to mutate nested state must
 * clone it themselves. If a future schema adds retired aliases deeper
 * inside the payload, extend this function explicitly rather than adding
 * recursion to `rename()`.
 */
export function migrate_v1_0_to_v1_1(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;

  const cloned: Record<string, unknown> = { ...raw };

  const header = isPlainObject(cloned.header) ? { ...cloned.header } : null;
  if (header) {
    rename(header, "producer_id", "producer_key");
    rename(header, "consumer_hint", "consumer_key");
    if (
      typeof header.schema_version === "string" &&
      header.schema_version.startsWith("1.0.")
    ) {
      header.schema_version = "1.1.0";
    }
    cloned.header = header;
  }

  if (isPlainObject(cloned.authority)) {
    const authority = { ...cloned.authority };
    rename(authority, "stamped_by", "stamped_by_key");
    cloned.authority = authority;
  }

  if (isPlainObject(cloned.trace)) {
    const trace = { ...cloned.trace };
    rename(trace, "trace_id", "trace_uuid");
    rename(trace, "stream_id", "stream_uuid");
    rename(trace, "span_id", "span_uuid");
    cloned.trace = trace;
  }

  if (isPlainObject(cloned.control)) {
    const control = { ...cloned.control };
    rename(control, "reply_to", "reply_to_message_uuid");
    cloned.control = control;
  }

  if (isPlainObject(cloned.session_frame)) {
    const sf = { ...cloned.session_frame };
    rename(sf, "stream_id", "stream_uuid");
    cloned.session_frame = sf;
  }

  // Bare session-body rename (session.stream.ack carries stream_id directly).
  const mt =
    header && typeof header.message_type === "string" ? header.message_type : null;
  if (mt === "session.stream.ack" && isPlainObject(cloned.body)) {
    const body = { ...cloned.body };
    rename(body, "stream_id", "stream_uuid");
    cloned.body = body;
  }

  return cloned;
}
