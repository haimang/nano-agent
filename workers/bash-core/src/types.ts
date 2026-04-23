export interface BashCoreEnv {
  readonly ENVIRONMENT?: string;
  readonly OWNER_TAG?: string;
}

export interface BashCoreShellResponse {
  readonly worker: "bash-core";
  readonly nacp_core_version: string;
  readonly nacp_session_version: string;
  readonly status: "ok";
  readonly phase: "pre-worker-matrix-W4-shell";
}
