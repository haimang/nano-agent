/**
 * Session DO Runtime — Session-level checkpoint.
 *
 * Combines ALL subsystem fragments into a single SessionCheckpoint
 * that can be persisted across Durable Object hibernation cycles
 * and used for restore-on-wake.
 *
 * Subsystem fragments composed:
 *   - kernelFragment    (agent-runtime-kernel: KernelCheckpointFragment)
 *   - replayFragment    (SessionWebSocketHelper.checkpoint())
 *   - streamSeqs        (per-stream sequence numbers)
 *   - workspaceFragment (workspace-context-artifacts: WorkspaceSnapshotFragment)
 *   - hooksFragment     (hooks: HookRegistrySnapshot)
 *   - usageSnapshot     (session-level usage counters)
 *
 * Reference: docs/action-plan/session-do-runtime.md Phase 5
 */

import { SESSION_DO_VERSION } from "./version.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Usage Snapshot
// ═══════════════════════════════════════════════════════════════════

/** Cumulative usage counters for a session. */
export interface UsageSnapshot {
  readonly totalTokens: number;
  readonly totalTurns: number;
  readonly totalDurationMs: number;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — Session Checkpoint
// ═══════════════════════════════════════════════════════════════════

/**
 * Full session checkpoint combining all subsystem fragments.
 *
 * Each fragment field is typed as `unknown` at this layer because the
 * session-do-runtime does not directly import subsystem packages.
 * Concrete types are enforced at the composition boundary.
 */
export interface SessionCheckpoint {
  readonly version: string;
  readonly sessionUuid: string;
  readonly teamUuid: string;
  readonly actorPhase: string;
  readonly turnCount: number;
  readonly kernelFragment: unknown;
  readonly replayFragment: unknown;
  readonly streamSeqs: Record<string, number>;
  readonly workspaceFragment: unknown;
  readonly hooksFragment: unknown;
  readonly usageSnapshot: UsageSnapshot;
  readonly checkpointedAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// §3 — Checkpoint Dependencies
// ═══════════════════════════════════════════════════════════════════

/**
 * Dependency injection interface for building a session checkpoint.
 *
 * Each getter retrieves the current fragment from the owning subsystem.
 * Some are async (workspace, replay) because they may require I/O;
 * others are sync (kernel, hooks, stream seqs) because they read
 * in-memory state.
 */
export interface CheckpointDeps {
  readonly getKernelFragment: () => unknown;
  readonly getReplayFragment: () => Promise<unknown>;
  readonly getStreamSeqs: () => Record<string, number>;
  readonly getWorkspaceFragment: () => Promise<unknown>;
  readonly getHooksFragment: () => unknown;
}

// ═══════════════════════════════════════════════════════════════════
// §4 — buildSessionCheckpoint
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a full session checkpoint by collecting fragments from all
 * subsystems via the injected deps.
 *
 * This is an async operation because workspace and replay fragments
 * may require I/O (e.g. flushing pending writes).
 */
export async function buildSessionCheckpoint(
  sessionUuid: string,
  teamUuid: string,
  actorPhase: string,
  turnCount: number,
  usage: UsageSnapshot,
  deps: CheckpointDeps,
): Promise<SessionCheckpoint> {
  // Gather async fragments in parallel for efficiency.
  const [replayFragment, workspaceFragment] = await Promise.all([
    deps.getReplayFragment(),
    deps.getWorkspaceFragment(),
  ]);

  // Gather sync fragments.
  const kernelFragment = deps.getKernelFragment();
  const streamSeqs = deps.getStreamSeqs();
  const hooksFragment = deps.getHooksFragment();

  return {
    version: SESSION_DO_VERSION,
    sessionUuid,
    teamUuid,
    actorPhase,
    turnCount,
    kernelFragment,
    replayFragment,
    streamSeqs,
    workspaceFragment,
    hooksFragment,
    usageSnapshot: usage,
    checkpointedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// §5 — validateSessionCheckpoint
// ═══════════════════════════════════════════════════════════════════

/** UUID shape check (v1-v5) — reused by the checkpoint validator. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Type guard that validates whether an unknown value is a valid
 * `SessionCheckpoint`.
 *
 * v1 contract:
 *   - `sessionUuid` / `teamUuid` MUST be non-empty UUID strings.
 *   - `actorPhase` MUST be one of the 4 canonical actor phases.
 *   - `turnCount` MUST be a non-negative integer.
 *   - `streamSeqs` MUST be a map of string → non-negative integer.
 *   - `usageSnapshot.totalTokens / totalTurns / totalDurationMs` MUST be
 *     non-negative numbers (integer for totals, ms may be fractional).
 *   - All fragment fields must be present (content validated by their
 *     owning packages when restored).
 */
export function validateSessionCheckpoint(
  raw: unknown,
): raw is SessionCheckpoint {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return false;
  }

  const obj = raw as Record<string, unknown>;

  // Required non-empty strings.
  if (typeof obj["version"] !== "string" || obj["version"].length === 0) return false;

  if (typeof obj["sessionUuid"] !== "string" || !UUID_RE.test(obj["sessionUuid"] as string)) {
    return false;
  }
  if (typeof obj["teamUuid"] !== "string" || (obj["teamUuid"] as string).length === 0) {
    return false;
  }

  const VALID_PHASES = new Set(["unattached", "attached", "turn_running", "ended"]);
  if (typeof obj["actorPhase"] !== "string" || !VALID_PHASES.has(obj["actorPhase"] as string)) {
    return false;
  }

  if (typeof obj["checkpointedAt"] !== "string" || Number.isNaN(Date.parse(obj["checkpointedAt"] as string))) {
    return false;
  }

  // turnCount: non-negative integer.
  if (typeof obj["turnCount"] !== "number" || !Number.isInteger(obj["turnCount"]) || (obj["turnCount"] as number) < 0) {
    return false;
  }

  // streamSeqs: Record<string, non-negative integer>.
  if (typeof obj["streamSeqs"] !== "object" || obj["streamSeqs"] === null) {
    return false;
  }
  const seqs = obj["streamSeqs"] as Record<string, unknown>;
  for (const key of Object.keys(seqs)) {
    const v = seqs[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return false;
  }

  // usageSnapshot with non-negative fields.
  if (typeof obj["usageSnapshot"] !== "object" || obj["usageSnapshot"] === null) {
    return false;
  }
  const usage = obj["usageSnapshot"] as Record<string, unknown>;
  for (const k of ["totalTokens", "totalTurns", "totalDurationMs"] as const) {
    const v = usage[k];
    if (typeof v !== "number" || v < 0 || Number.isNaN(v)) return false;
    // totalTokens + totalTurns are counts → must be integers
    if (k !== "totalDurationMs" && !Number.isInteger(v)) return false;
  }

  // Fragment fields must be present (content can be any value or null).
  for (const k of ["kernelFragment", "replayFragment", "workspaceFragment", "hooksFragment"]) {
    if (!(k in obj)) return false;
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════
// §6 — restoreSessionCheckpoint
// ═══════════════════════════════════════════════════════════════════

/**
 * Dependency injection interface for restoring a session from a
 * previously-persisted checkpoint. Each restore call routes the matching
 * fragment to the owning subsystem; the caller threads the returned
 * values into the live orchestration state.
 */
export interface RestoreDeps {
  readonly restoreKernel: (fragment: unknown) => unknown;
  readonly restoreReplay: (fragment: unknown) => Promise<void> | void;
  readonly restoreWorkspace: (fragment: unknown) => Promise<unknown> | unknown;
  readonly restoreHooks: (fragment: unknown) => unknown;
}

/** Result of restoring all subsystem fragments. */
export interface RestoredCheckpoint {
  readonly kernelSnapshot: unknown;
  readonly workspaceSnapshot: unknown;
  readonly hooksSnapshot: unknown;
  readonly streamSeqs: Record<string, number>;
  readonly actorPhase: string;
  readonly turnCount: number;
  readonly usage: UsageSnapshot;
}

/**
 * Restore a session from a persisted `SessionCheckpoint`.
 *
 * Validates the checkpoint first, then dispatches each fragment to its
 * owning subsystem via `deps`. Returns the individual restored values
 * in a single record so the caller (Session DO) can thread them into
 * its orchestration state.
 *
 * Throws a `CheckpointInvalidError` (A3 P3-02 — taxonomy code
 * `checkpoint-invalid`) when the checkpoint fails validation so callers
 * do NOT silently continue with a half-restored state. The error name
 * matches the eval-observability `TraceRecoveryReason` so observers can
 * route to the same dashboard.
 */
export class CheckpointInvalidError extends Error {
  readonly reason = "checkpoint-invalid" as const;
  constructor(message: string) {
    super(message);
    this.name = "CheckpointInvalidError";
  }
}

export async function restoreSessionCheckpoint(
  raw: unknown,
  deps: RestoreDeps,
): Promise<RestoredCheckpoint> {
  if (!validateSessionCheckpoint(raw)) {
    throw new CheckpointInvalidError(
      "restoreSessionCheckpoint: invalid checkpoint (taxonomy: checkpoint-invalid)",
    );
  }

  const kernelSnapshot = deps.restoreKernel(raw.kernelFragment);
  await deps.restoreReplay(raw.replayFragment);
  const workspaceSnapshot = await deps.restoreWorkspace(raw.workspaceFragment);
  const hooksSnapshot = deps.restoreHooks(raw.hooksFragment);

  return {
    kernelSnapshot,
    workspaceSnapshot,
    hooksSnapshot,
    streamSeqs: { ...raw.streamSeqs },
    actorPhase: raw.actorPhase,
    turnCount: raw.turnCount,
    usage: raw.usageSnapshot,
  };
}
