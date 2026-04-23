export interface ContextCoreEnv {
  readonly ENVIRONMENT?: string;
  readonly OWNER_TAG?: string;
}

export interface ContextCoreShellResponse {
  readonly worker: "context-core";
  readonly nacp_core_version: string;
  readonly nacp_session_version: string;
  readonly status: "ok";
  readonly phase: "pre-worker-matrix-W4-shell";
}
