/**
 * @nano-agent/eval-observability — Trace Anchor & Recovery helper (A3 Phase 3).
 *
 * Establishes the minimum anchor shape and recovery error taxonomy that the
 * Session DO Runtime, checkpoint/restore path, and ingress layer use when
 * they receive work that is missing — or inconsistent with — its trace
 * identity.
 *
 * Design principles (docs/action-plan/after-skeleton/A3-*.md §5.3):
 *   - Recovery is not a best-effort catch block. Every loss surface maps
 *     onto a specific {@link TraceRecoveryReason}.
 *   - Accepted internal work without a trace anchor must either be
 *     recovered (by threading a known anchor from the surrounding
 *     context) or explicitly rejected with {@link TraceRecoveryError}.
 *   - Anchors are strictly additive — the helper NEVER mutates the
 *     candidate event; it returns a repaired copy, or throws.
 *   - A caller that silently catches {@link TraceRecoveryError} and
 *     continues is violating trace law. Callers MUST either:
 *       (a) retry with a valid anchor,
 *       (b) quarantine the candidate and record the reason, or
 *       (c) fail the turn / fail the checkpoint.
 *
 * The taxonomy is referenced from session-do-runtime's checkpoint, alarm,
 * and turn-ingress seams so the same vocabulary shows up in docs, code,
 * and dashboards.
 */

import type { TraceEvent } from "./trace-event.js";
import { validateTraceEvent } from "./trace-event.js";
import type { TraceSourceRole } from "./types.js";

// ─────────────────────────────────────────────────────────────────────
// Taxonomy
// ─────────────────────────────────────────────────────────────────────

/**
 * The set of reasons a trace recovery attempt can fail. Must stay in sync
 * with the A3 §5.3 closure standard.
 */
export type TraceRecoveryReason =
  | "anchor-missing"
  | "anchor-ambiguous"
  | "checkpoint-invalid"
  | "timeline-readback-failed"
  | "compat-unrecoverable"
  | "cross-seam-trace-loss"
  | "trace-carrier-mismatch"
  | "replay-window-gap";

export const TRACE_RECOVERY_REASONS: readonly TraceRecoveryReason[] = [
  "anchor-missing",
  "anchor-ambiguous",
  "checkpoint-invalid",
  "timeline-readback-failed",
  "compat-unrecoverable",
  "cross-seam-trace-loss",
  "trace-carrier-mismatch",
  "replay-window-gap",
];

/**
 * Explicit error thrown when the trace anchor cannot be established.
 * Callers must handle this by quarantining the work or failing the turn
 * — never by silent continuation.
 */
export class TraceRecoveryError extends Error {
  readonly reason: TraceRecoveryReason;
  readonly detail?: Record<string, unknown>;

  constructor(
    reason: TraceRecoveryReason,
    message: string,
    detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TraceRecoveryError";
    this.reason = reason;
    this.detail = detail;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Anchor shape
// ─────────────────────────────────────────────────────────────────────

/**
 * The minimal anchor threaded through accepted internal work.
 *
 * `traceUuid` + `sourceRole` are load-bearing; everything else is a hint
 * that improves attribution but does not by itself anchor the event.
 */
export interface TraceAnchor {
  readonly traceUuid: string;
  readonly sessionUuid: string;
  readonly teamUuid: string;
  readonly sourceRole: TraceSourceRole;
  readonly sourceKey?: string;
  readonly turnUuid?: string;
  readonly messageUuid?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Recovery API
// ─────────────────────────────────────────────────────────────────────

/**
 * Candidate event entering a trace-law boundary. Fields may be missing.
 * Callers pass the raw event through {@link attemptTraceRecovery} to
 * either obtain a repaired {@link TraceEvent} or receive a typed error.
 */
export type TraceCandidate = Partial<TraceEvent> &
  Pick<TraceEvent, "eventKind" | "timestamp" | "audience" | "layer">;

/** Options for {@link attemptTraceRecovery}. */
export interface TraceRecoveryOptions {
  /**
   * The primary anchor to apply. Required for recovery — absence is an
   * `anchor-missing` error.
   */
  readonly anchor?: TraceAnchor;
  /**
   * A secondary anchor (e.g. a checkpoint restored anchor). If supplied,
   * it must match `anchor` on `traceUuid`; a mismatch produces an
   * `anchor-ambiguous` error.
   */
  readonly secondaryAnchor?: TraceAnchor;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s: string | undefined): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

/**
 * Attempt to thread a trace anchor onto a candidate event. Returns a
 * trace-law-compliant {@link TraceEvent} on success; throws
 * {@link TraceRecoveryError} on any recovery failure.
 *
 * Recovery rules:
 *   - If the candidate already carries a valid trace carrier AND no
 *     anchor mismatches it, return a fresh object that merges the two
 *     (candidate values win for fields that are already present).
 *   - If the candidate is missing the carrier but the anchor is
 *     provided, thread the anchor onto the candidate.
 *   - If the anchor is missing, the candidate MUST already carry a
 *     valid carrier; otherwise throw `anchor-missing`.
 *   - If the candidate's `traceUuid` disagrees with the anchor's,
 *     throw `trace-carrier-mismatch`.
 *   - If both `anchor` and `secondaryAnchor` are supplied and their
 *     `traceUuid`s differ, throw `anchor-ambiguous`.
 */
export function attemptTraceRecovery(
  candidate: TraceCandidate,
  opts: TraceRecoveryOptions = {},
): TraceEvent {
  const { anchor, secondaryAnchor } = opts;

  if (anchor && secondaryAnchor && anchor.traceUuid !== secondaryAnchor.traceUuid) {
    throw new TraceRecoveryError(
      "anchor-ambiguous",
      `primary anchor ${anchor.traceUuid} disagrees with secondary ${secondaryAnchor.traceUuid}`,
      { primary: anchor.traceUuid, secondary: secondaryAnchor.traceUuid },
    );
  }

  if (
    anchor &&
    candidate.traceUuid &&
    candidate.traceUuid !== anchor.traceUuid
  ) {
    throw new TraceRecoveryError(
      "trace-carrier-mismatch",
      `candidate traceUuid ${candidate.traceUuid} disagrees with anchor ${anchor.traceUuid}`,
      {
        candidate: candidate.traceUuid,
        anchor: anchor.traceUuid,
      },
    );
  }

  const traceUuid = candidate.traceUuid ?? anchor?.traceUuid;
  if (!isUuid(traceUuid)) {
    throw new TraceRecoveryError(
      "anchor-missing",
      `no valid traceUuid available for event '${candidate.eventKind}'`,
      { eventKind: candidate.eventKind },
    );
  }

  const sessionUuid = candidate.sessionUuid ?? anchor?.sessionUuid;
  const teamUuid = candidate.teamUuid ?? anchor?.teamUuid;
  const sourceRole = candidate.sourceRole ?? anchor?.sourceRole;
  if (!sessionUuid || !teamUuid || !sourceRole) {
    throw new TraceRecoveryError(
      "anchor-missing",
      `cannot establish anchor for '${candidate.eventKind}': sessionUuid/teamUuid/sourceRole unresolved`,
      { eventKind: candidate.eventKind, sessionUuid, teamUuid, sourceRole },
    );
  }

  const repaired: TraceEvent = {
    ...candidate,
    traceUuid,
    sessionUuid,
    teamUuid,
    sourceRole,
    sourceKey: candidate.sourceKey ?? anchor?.sourceKey,
    turnUuid: candidate.turnUuid ?? anchor?.turnUuid,
    messageUuid: candidate.messageUuid ?? anchor?.messageUuid,
  } as TraceEvent;

  const violations = validateTraceEvent(repaired);
  if (violations.length > 0) {
    throw new TraceRecoveryError(
      "anchor-missing",
      `trace law still violated after recovery: ${violations
        .map((v) => v.reason)
        .join(", ")}`,
      { violations: violations.map((v) => v.reason) },
    );
  }

  return repaired;
}

/**
 * Utility to build a {@link TraceRecoveryError} from a raw cause without
 * duplicating the constructor boilerplate. Useful for adapting other
 * subsystems' errors into the canonical taxonomy.
 */
export function traceRecoveryError(
  reason: TraceRecoveryReason,
  message: string,
  detail?: Record<string, unknown>,
): TraceRecoveryError {
  return new TraceRecoveryError(reason, message, detail);
}
