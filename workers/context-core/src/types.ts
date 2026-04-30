export interface ContextCoreEnv {
  readonly ENVIRONMENT?: string;
  readonly OWNER_TAG?: string;
  readonly WORKER_VERSION?: string;
  readonly ORCHESTRATOR_CORE?: Fetcher & Record<string, unknown>;
}

export interface ContextCoreShellResponse {
  readonly worker: "context-core";
  readonly nacp_core_version: string;
  readonly nacp_session_version: string;
  readonly status: "ok";
  readonly worker_version: string;
  readonly phase: "worker-matrix-P3-absorbed";
  readonly absorbed_runtime: true;
}
