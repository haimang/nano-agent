import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import type { OrchestratorAuthRpcService } from "@haimang/orchestrator-auth-contract";
import type { AuthEnv } from "../auth.js";
import { createOrchestratorLogger } from "../observability.js";

export type AgentRpcMethod = (
  input: Record<string, unknown>,
  meta: { trace_uuid: string; authority: unknown },
) => Promise<{ status: number; body: Record<string, unknown> | null }>;

export interface OrchestratorCoreEnv extends AuthEnv {
  readonly ORCHESTRATOR_USER_DO: DurableObjectNamespace;
  readonly AGENT_CORE?: Fetcher & {
    start?: AgentRpcMethod;
    status?: AgentRpcMethod;
    input?: AgentRpcMethod;
    cancel?: AgentRpcMethod;
    verify?: AgentRpcMethod;
    timeline?: AgentRpcMethod;
    streamSnapshot?: AgentRpcMethod;
    permissionDecision?: AgentRpcMethod;
    elicitationAnswer?: AgentRpcMethod;
  };
  readonly ORCHESTRATOR_AUTH?: OrchestratorAuthRpcService & Fetcher;
  readonly BASH_CORE?: Fetcher;
  readonly CONTEXT_CORE?: Fetcher;
  readonly FILESYSTEM_CORE?: Fetcher & {
    /**
     * HPX5 F5 — workspace temp file bytes read. Mirrors filesystem-core
     * RPC `readTempFile` (workers/filesystem-core/src/index.ts:160-175).
     */
    readTempFile?(
      input: {
        readonly team_uuid: string;
        readonly session_uuid: string;
        readonly virtual_path: string;
      },
      meta?: { readonly trace_uuid?: string; readonly team_uuid?: string },
    ): Promise<{
      ok: boolean;
      r2_key: string;
      bytes: ArrayBuffer | null;
      mime: string | null;
    }>;
  };
  readonly NANO_AGENT_DB?: D1Database;
  readonly NANO_INTERNAL_BINDING_SECRET?: string;
  readonly ENVIRONMENT?: string;
  readonly OWNER_TAG?: string;
  readonly WORKER_VERSION?: string;
  readonly NODE_AUTH_TOKEN?: string;
  readonly GITHUB_TOKEN?: string;
}

export interface OrchestratorCoreShellResponse {
  readonly worker: "orchestrator-core";
  readonly nacp_core_version: string;
  readonly nacp_session_version: string;
  readonly status: "ok";
  readonly worker_version: string;
  readonly phase: "orchestration-facade-closed";
  readonly public_facade: true;
  readonly agent_binding: boolean;
}

export interface WorkerHealthProbeBody {
  readonly worker?: string;
  readonly status?: string;
  readonly worker_version?: string;
  readonly [key: string]: unknown;
}

export interface WorkerHealthEntry {
  readonly worker: string;
  readonly live: boolean;
  readonly status: string;
  readonly worker_version: string | null;
  readonly details?: Record<string, unknown>;
  readonly error?: string;
}

export function getLogger(env: OrchestratorCoreEnv) {
  return createOrchestratorLogger(env);
}

export function createShellResponse(env: OrchestratorCoreEnv): OrchestratorCoreShellResponse {
  return {
    worker: "orchestrator-core",
    nacp_core_version: NACP_VERSION,
    nacp_session_version: NACP_SESSION_VERSION,
    status: "ok",
    worker_version: env.WORKER_VERSION ?? `orchestrator-core@${env.ENVIRONMENT ?? "dev"}`,
    phase: "orchestration-facade-closed",
    public_facade: true,
    agent_binding: Boolean(env.AGENT_CORE),
  };
}
