export interface ContextCoreEnv {
  readonly ENVIRONMENT?: string;
  readonly OWNER_TAG?: string;
}

export interface ContextCoreShellResponse {
  readonly worker: "context-core";
  readonly nacp_core_version: string;
  readonly nacp_session_version: string;
  readonly status: "ok";
  readonly phase: "worker-matrix-P3-absorbed";
  readonly absorbed_runtime: true;
}
