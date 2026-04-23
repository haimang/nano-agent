export interface AgentCoreEnv {
  readonly SESSION_DO: DurableObjectNamespace;
  readonly BASH_CORE?: Fetcher;
  readonly CONTEXT_CORE?: Fetcher;
  readonly FILESYSTEM_CORE?: Fetcher;
  readonly ENVIRONMENT?: string;
  readonly OWNER_TAG?: string;
}

export interface AgentCoreShellResponse {
  readonly worker: "agent-core";
  readonly nacp_core_version: string;
  readonly nacp_session_version: string;
  readonly status: "ok";
  readonly phase: "pre-worker-matrix-W4-shell";
}

export interface AgentCoreDoResponse {
  readonly worker: "agent-core";
  readonly role: "session-do-stub";
  readonly status: "shell";
}
