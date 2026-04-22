/**
 * Cross-seam propagation truth for pre-worker-matrix W0.
 *
 * This file deliberately contains only the header/anchor contract that
 * must be shared across workers. Failure taxonomy and startup buffering
 * remain runtime concerns owned by `session-do-runtime`.
 */

/**
 * The minimum identity carriers every cross-seam call must thread.
 * Header names mirror snake_case wire fields so receivers can consume
 * them without translation.
 */
export interface CrossSeamAnchor {
  readonly traceUuid: string;
  readonly sessionUuid: string;
  readonly teamUuid: string;
  readonly requestUuid: string;
  readonly sourceRole?: string;
  readonly sourceKey?: string;
  readonly deadlineMs?: number;
}

/** Standard HTTP headers stamped on every cross-seam request. */
export const CROSS_SEAM_HEADERS = {
  trace: "x-nacp-trace-uuid",
  session: "x-nacp-session-uuid",
  team: "x-nacp-team-uuid",
  request: "x-nacp-request-uuid",
  sourceRole: "x-nacp-source-role",
  sourceKey: "x-nacp-source-key",
  deadline: "x-nacp-deadline-ms",
} as const;

/**
 * Build a plain object suitable for merging into `RequestInit.headers`.
 */
export function buildCrossSeamHeaders(anchor: CrossSeamAnchor): Record<string, string> {
  const out: Record<string, string> = {
    [CROSS_SEAM_HEADERS.trace]: anchor.traceUuid,
    [CROSS_SEAM_HEADERS.session]: anchor.sessionUuid,
    [CROSS_SEAM_HEADERS.team]: anchor.teamUuid,
    [CROSS_SEAM_HEADERS.request]: anchor.requestUuid,
  };
  if (anchor.sourceRole) out[CROSS_SEAM_HEADERS.sourceRole] = anchor.sourceRole;
  if (anchor.sourceKey) out[CROSS_SEAM_HEADERS.sourceKey] = anchor.sourceKey;
  if (anchor.deadlineMs !== undefined) {
    out[CROSS_SEAM_HEADERS.deadline] = String(anchor.deadlineMs);
  }
  return out;
}

/** Read a `CrossSeamAnchor` back out of a `Headers`-like object. */
export function readCrossSeamHeaders(
  headers: { get(name: string): string | null },
): Partial<CrossSeamAnchor> {
  const get = (k: string) => headers.get(k) ?? undefined;
  const draft: {
    -readonly [K in keyof CrossSeamAnchor]?: CrossSeamAnchor[K];
  } = {};
  const traceUuid = get(CROSS_SEAM_HEADERS.trace);
  if (traceUuid) draft.traceUuid = traceUuid;
  const sessionUuid = get(CROSS_SEAM_HEADERS.session);
  if (sessionUuid) draft.sessionUuid = sessionUuid;
  const teamUuid = get(CROSS_SEAM_HEADERS.team);
  if (teamUuid) draft.teamUuid = teamUuid;
  const requestUuid = get(CROSS_SEAM_HEADERS.request);
  if (requestUuid) draft.requestUuid = requestUuid;
  const sourceRole = get(CROSS_SEAM_HEADERS.sourceRole);
  if (sourceRole) draft.sourceRole = sourceRole;
  const sourceKey = get(CROSS_SEAM_HEADERS.sourceKey);
  if (sourceKey) draft.sourceKey = sourceKey;
  const deadlineRaw = get(CROSS_SEAM_HEADERS.deadline);
  if (deadlineRaw) {
    const v = Number(deadlineRaw);
    if (Number.isFinite(v)) draft.deadlineMs = v;
  }
  return draft;
}

/**
 * Return the missing load-bearing fields callers must reject or fill.
 */
export function validateCrossSeamAnchor(
  anchor: Partial<CrossSeamAnchor>,
): readonly (keyof CrossSeamAnchor)[] {
  const missing: (keyof CrossSeamAnchor)[] = [];
  if (!anchor.traceUuid) missing.push("traceUuid");
  if (!anchor.sessionUuid) missing.push("sessionUuid");
  if (!anchor.teamUuid) missing.push("teamUuid");
  if (!anchor.requestUuid) missing.push("requestUuid");
  return missing;
}
