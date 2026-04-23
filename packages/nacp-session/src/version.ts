/**
 * NACP-Session Version Constants.
 *
 * The Session profile follows the core NACP baseline: A1 (Phase 0 contract
 * freeze) cut `1.1.0` as the first owner-aligned frozen baseline after the
 * identifier-law rename and the widened `session.followup_input` family
 * landed. `NACP_SESSION_VERSION_COMPAT` stays at `1.0.0` so a 1.1 session
 * reader can still accept pre-freeze payloads through
 * `@haimang/nacp-core`'s `migrate_v1_0_to_v1_1()`.
 *
 * The WebSocket subprotocol label stays `nacp-session.v1` — the major line
 * never moved, and a minor bump inside v1 does not change the handshake
 * token (consumers that want to reject pre-freeze baselines must inspect
 * `header.schema_version` on the first frame instead).
 */

export const NACP_SESSION_VERSION = "1.3.0";
export const NACP_SESSION_VERSION_COMPAT = "1.0.0";
export const NACP_SESSION_WS_SUBPROTOCOL = "nacp-session.v1";
