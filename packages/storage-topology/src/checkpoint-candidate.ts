/**
 * Storage Topology — Candidate Checkpoint Fragment Definition.
 *
 * A session checkpoint is NOT a single opaque blob; it is the union of
 * fragments owned by distinct subsystems. This module freezes the
 * fragment boundaries and enumerates candidate fields each fragment
 * carries, so topology consumers can reason about which subsystem is
 * responsible for persisting a given field.
 *
 * Fragment boundaries (v1, frozen):
 *
 *   - kernel       : agent-runtime-kernel snapshot + in-flight tool state
 *   - session      : nacp-session replay / stream-seqs / heartbeat markers
 *   - workspace    : mount configs, file index (delegated to workspace
 *                    package), artifact refs that MUST survive restore
 *   - hooks        : per-session hook registry snapshot
 *   - usage        : session-level usage counters
 *
 * Each candidate field declares (1) its owning fragment, (2) whether
 * it is frozen or provisional, (3) a pending-question list that must
 * be answered before it can be promoted out of provisional status.
 */

import type { ResponsibleRuntime } from "./taxonomy.js";

/** Fragment identifiers used inside a `SessionCheckpoint`. */
export type CheckpointFragment =
  | "kernel"
  | "session"
  | "workspace"
  | "hooks"
  | "usage";

/** A single candidate field for inclusion in a session checkpoint. */
export interface CheckpointCandidateField {
  readonly fieldName: string;
  readonly source: string;
  readonly provisional: boolean;
  readonly fragment: CheckpointFragment;
  readonly ownerRuntime: ResponsibleRuntime;
  readonly notes: string;
  /**
   * Open questions that must be answered before the candidate can be
   * promoted from provisional to frozen. Empty for already-frozen
   * fields.
   */
  readonly pendingQuestions: readonly string[];
  /**
   * Optional MIME-type gate note — flags fields that may carry
   * attachment payloads and therefore need to pass the
   * `applyMimePolicy()` gate before being written inline into the
   * checkpoint body. Absent for fields that never carry attachments.
   */
  readonly mimeGate?: "delegate-to-workspace" | "inline-only" | "ref-only";
}

/**
 * All candidate checkpoint fields. Each entry declares its owning
 * fragment, runtime owner, and open questions.
 */
export const CHECKPOINT_CANDIDATE_FIELDS: readonly CheckpointCandidateField[] = [
  {
    fieldName: "session_phase",
    source: "session-phase",
    provisional: false,
    fragment: "session",
    ownerRuntime: "session-do",
    notes: "Frozen — session phase is inherently per-DO transactional state.",
    pendingQuestions: [],
  },
  {
    fieldName: "messages",
    source: "session-messages",
    provisional: true,
    fragment: "kernel",
    ownerRuntime: "session-do",
    notes: "Current message history. May be truncated or compacted before checkpoint.",
    pendingQuestions: [
      "How many recent turns must stay un-compacted so restore keeps enough context?",
    ],
  },
  {
    fieldName: "replay_buffer",
    source: "replay-buffer",
    provisional: false,
    fragment: "session",
    ownerRuntime: "session-do",
    notes: "Frozen — already defined by nacp-session (`nacp_session:replay` key).",
    pendingQuestions: [],
  },
  {
    fieldName: "stream_seqs",
    source: "stream-seqs",
    provisional: false,
    fragment: "session",
    ownerRuntime: "session-do",
    notes: "Frozen — already defined by nacp-session (`nacp_session:stream_seqs` key).",
    pendingQuestions: [],
  },
  {
    fieldName: "tool_inflight",
    source: "tool-inflight",
    provisional: true,
    fragment: "kernel",
    ownerRuntime: "capability",
    notes: "In-flight tool call state. Needed to resume interrupted tool executions.",
    pendingQuestions: [
      "Should partially-written tool outputs be rehydrated, or discarded on resume?",
    ],
  },
  {
    fieldName: "hooks_config",
    source: "hooks-config",
    provisional: true,
    fragment: "hooks",
    ownerRuntime: "hooks",
    notes: "Session-level hook configuration. May move to warm/KV if shared across sessions.",
    pendingQuestions: [
      "Do platform-policy hooks stay frozen across restore, or are they re-read from KV?",
    ],
  },
  {
    fieldName: "audit_trail",
    source: "audit-trail",
    provisional: true,
    fragment: "session",
    ownerRuntime: "eval",
    notes:
      "Current session audit trail. Periodic archive to R2 expected; checkpoint includes recent segment.",
    pendingQuestions: [
      "What is the maximum recent-segment size retained inside the checkpoint?",
    ],
  },
  {
    fieldName: "system_prompt",
    source: "system-prompt",
    provisional: true,
    fragment: "kernel",
    ownerRuntime: "session-do",
    notes: "System prompt snapshot. Revisit if system prompts become shared/cached across sessions.",
    pendingQuestions: [
      "Should a shared/cached system prompt be deduplicated via a KV ref instead of inlining?",
    ],
  },
  {
    fieldName: "turn_count",
    source: "session-phase",
    provisional: false,
    fragment: "session",
    ownerRuntime: "session-do",
    notes: "Turn counter co-located with session phase.",
    pendingQuestions: [],
  },
  {
    fieldName: "workspace_refs",
    source: "workspace",
    provisional: true,
    fragment: "workspace",
    ownerRuntime: "workspace",
    notes:
      "ArtifactRef / PreparedArtifactRef collection. Body content is NOT copied into the checkpoint; " +
      "the workspace package delegates to its own restore path.",
    pendingQuestions: [
      "Do we snapshot the full artifact index, or only artifacts referenced by the active turn?",
    ],
    mimeGate: "delegate-to-workspace",
  },
  {
    fieldName: "usage_snapshot",
    source: "usage-counters",
    provisional: false,
    fragment: "usage",
    ownerRuntime: "eval",
    notes: "Cumulative session usage counters (tokens / turns / ms).",
    pendingQuestions: [],
  },
];

/**
 * Summarise how many fields each fragment currently owns — useful for
 * `scripts/gen-placement-doc.ts` to render a per-fragment table.
 */
export function summarizeFragments(): Record<CheckpointFragment, number> {
  const acc: Record<CheckpointFragment, number> = {
    kernel: 0,
    session: 0,
    workspace: 0,
    hooks: 0,
    usage: 0,
  };
  for (const field of CHECKPOINT_CANDIDATE_FIELDS) {
    acc[field.fragment] += 1;
  }
  return acc;
}
