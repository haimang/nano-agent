/**
 * Centralized storage key builders that form the cross-worker law.
 * These are absorbed from `storage-topology` during W0.
 */

export const DO_KEYS = {
  SESSION_PHASE: "session:phase",
  SESSION_MESSAGES: "session:messages",
  SESSION_TURN_COUNT: "session:turn_count",
  SESSION_SYSTEM_PROMPT: "context:system_prompt",
  SESSION_HOOKS_CONFIG: "hooks:session_config",
  NACP_SESSION_REPLAY: "nacp_session:replay",
  NACP_SESSION_STREAM_SEQS: "nacp_session:stream_seqs",
  toolInflight: (requestUuid: string) => `tool:inflight:${requestUuid}`,
  audit: (date: string) => `audit:${date}`,
  workspaceFile: (path: string) => `workspace:file:${path}`,
} as const;

export const KV_KEYS = {
  providerConfig: (teamUuid: string) => `tenants/${teamUuid}/config/providers`,
  modelRegistry: (teamUuid: string) => `tenants/${teamUuid}/config/models`,
  skillManifest: (teamUuid: string) => `tenants/${teamUuid}/config/skills`,
  hooksPolicy: (teamUuid: string) => `tenants/${teamUuid}/config/hooks_policy`,
  featureFlags: () => "_platform/config/feature_flags",
} as const;

export const R2_KEYS = {
  workspaceFile: (teamUuid: string, sessionUuid: string, path: string) =>
    `tenants/${teamUuid}/sessions/${sessionUuid}/workspace/${path}`,
  compactArchive: (teamUuid: string, sessionUuid: string, range: string) =>
    `tenants/${teamUuid}/sessions/${sessionUuid}/archive/${range}.jsonl`,
  sessionTranscript: (teamUuid: string, sessionUuid: string) =>
    `tenants/${teamUuid}/sessions/${sessionUuid}/transcript.jsonl`,
  auditArchive: (teamUuid: string, date: string, sessionUuid: string) =>
    `tenants/${teamUuid}/audit/${date}/${sessionUuid}.jsonl`,
  attachment: (teamUuid: string, attachmentUuid: string) =>
    `tenants/${teamUuid}/attachments/${attachmentUuid}`,
} as const;
