/**
 * Storage Topology — Archive Plan Contracts.
 *
 * Defines when and how data moves from hot/warm tiers to cold (R2)
 * storage for archival. Each plan specifies a trigger condition,
 * source/target backends, key builder, and the responsible runtime.
 */

import type { ResponsibleRuntime, StorageBackend } from "./taxonomy.js";
import { R2_KEYS } from "./keys.js";

/** An archive plan describing a hot/warm -> cold data movement. */
export interface ArchivePlan {
  readonly trigger: string;
  readonly sourceBackend: StorageBackend;
  readonly targetBackend: StorageBackend;
  readonly keyBuilder: (teamUuid: string, sessionUuid: string, ...args: string[]) => string;
  readonly responsibleRuntime: ResponsibleRuntime;
}

/**
 * Pre-defined archive plans for the v1 storage topology.
 *
 * Each plan documents a specific data movement path from a hot or
 * warm tier into cold (R2) storage.
 */
export const ARCHIVE_PLANS: readonly ArchivePlan[] = [
  {
    trigger: "compact — when message history exceeds compaction threshold",
    sourceBackend: "do-storage",
    targetBackend: "r2",
    keyBuilder: (teamUuid, sessionUuid, ...args) =>
      R2_KEYS.compactArchive(teamUuid, sessionUuid, args[0] ?? "0-0"),
    responsibleRuntime: "session-do",
  },
  {
    trigger: "session.end — full transcript archived on session completion",
    sourceBackend: "do-storage",
    targetBackend: "r2",
    keyBuilder: (teamUuid, sessionUuid) =>
      R2_KEYS.sessionTranscript(teamUuid, sessionUuid),
    responsibleRuntime: "session-do",
  },
  {
    trigger: "periodic — audit trail rotation (daily or on threshold)",
    sourceBackend: "do-storage",
    targetBackend: "r2",
    keyBuilder: (teamUuid, sessionUuid, ...args) =>
      R2_KEYS.auditArchive(teamUuid, args[0] ?? "1970-01-01", sessionUuid),
    responsibleRuntime: "eval",
  },
  {
    // NOTE: the size threshold is PROVISIONAL (see calibration.ts
    // `DEFAULT_DO_SIZE_THRESHOLD_BYTES`) — the trigger only describes
    // the condition class ("uploaded workspace file exceeds the inline
    // recommendation") rather than a frozen byte cut-off.
    trigger: "upload — workspace file exceeds the provisional inline-size recommendation",
    sourceBackend: "do-storage",
    targetBackend: "r2",
    keyBuilder: (teamUuid, sessionUuid, ...args) =>
      R2_KEYS.workspaceFile(teamUuid, sessionUuid, args[0] ?? "unknown"),
    responsibleRuntime: "workspace",
  },
];
