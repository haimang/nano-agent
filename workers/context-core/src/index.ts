import { NACP_VERSION } from "@haimang/nacp-core";
import { respondWithFacadeError } from "@haimang/nacp-core/logger";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  buildCompactCommitInput,
  buildCompactPreviewResponse,
  buildContextLayersResponse,
  buildContextProbe,
  buildContextSnapshotPayload,
  type ContextDurableState,
} from "./control-plane.js";
import { NANO_PACKAGE_MANIFEST } from "./generated/package-manifest.js";
import type { ContextCoreEnv, ContextCoreShellResponse } from "./types.js";

void NANO_PACKAGE_MANIFEST;

function createShellResponse(env: ContextCoreEnv): ContextCoreShellResponse {
  return {
    worker: "context-core",
    nacp_core_version: NACP_VERSION,
    nacp_session_version: NACP_SESSION_VERSION,
    status: "ok",
    worker_version: env.WORKER_VERSION ?? `context-core@${env.ENVIRONMENT ?? "dev"}`,
    phase: "worker-matrix-P3-absorbed",
    absorbed_runtime: true,
  };
}

interface ContextBindingMeta {
  readonly trace_uuid: string;
  readonly team_uuid: string;
}

interface OrchestratorCoreContextRpcLike {
  readContextDurableState?(
    sessionUuid: string,
    teamUuid: string,
    meta: ContextBindingMeta,
  ): Promise<ContextDurableState | null>;
  createContextSnapshot?(
    sessionUuid: string,
    teamUuid: string,
    input: {
      readonly trace_uuid: string;
      readonly snapshot_kind: string;
      readonly prompt_token_estimate?: number | null;
      readonly payload: Record<string, unknown>;
      readonly created_at?: string;
    },
    meta: ContextBindingMeta,
  ): Promise<Record<string, unknown> | null>;
  commitContextCompact?(
    sessionUuid: string,
    teamUuid: string,
    input: {
      readonly trace_uuid: string;
      readonly created_at?: string;
      readonly tokens_before: number;
      readonly tokens_after: number;
      readonly prompt_token_estimate?: number | null;
      readonly summary_text: string;
      readonly message_high_watermark?: string | null;
      readonly protected_fragment_kinds?: ReadonlyArray<string>;
      readonly compacted_message_count?: number;
      readonly kept_message_count?: number;
    },
    meta: ContextBindingMeta,
  ): Promise<Record<string, unknown> | { status: "blocked"; reason: string } | null>;
  readContextCompactJob?(
    sessionUuid: string,
    teamUuid: string,
    jobId: string,
    meta: ContextBindingMeta,
  ): Promise<Record<string, unknown> | null>;
}

// ZX5 Lane E E1 — context-core 从 library-only(P1-03 binding-scope 401)
// uplift 为 WorkerEntrypoint RPC。保留 `/health` probe + 401 default,
// 但通过 service binding 的 RPC 调用走 WorkerEntrypoint method。
//
// 调用方:agent-core 在 wrangler.jsonc 打开 CONTEXT_CORE binding 后,
// 通过 `env.CONTEXT_CORE.contextOps(...)` 触达本 worker 的 RPC。
// 短期 shim 期间 agent-core 同时保留 in-process library import(per Q6
// owner direction:短期 shim 允许 + 长期双轨禁)。
//
// **保持 worker 总数 = 6**(per ZX5 Q4 + R8 owner direction;不新增 worker)。

// ZX2 P1-03 binding-scope guard 保留:non-/health public path 仍 401。
function bindingScopeForbidden(traceUuid: string): Response {
  return respondWithFacadeError(
    "binding-scope-forbidden",
    401,
    "context-core is a leaf worker; business access must use service-binding RPC",
    traceUuid,
    { worker: "context-core" },
  );
}

const worker = {
  async fetch(request: Request, env: ContextCoreEnv): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    const traceUuid = request.headers.get("x-trace-uuid") ?? crypto.randomUUID();

    if (method === "GET" && (pathname === "/" || pathname === "/health")) {
      return Response.json(createShellResponse(env));
    }

    return bindingScopeForbidden(traceUuid);
  },
};

// ZX5 Lane E E1 — WorkerEntrypoint RPC surface for context-core.
// agent-core 通过 service binding 调 context-core 的 RPC method(取代
// in-process `@haimang/context-core-worker/...` library import)。
//
// 当前 RPC 方法集是 minimal seam(per Q6 short-term shim — 不复制 agent-core
// 全部 in-process 行为):
//   - `probe()`              — health probe via RPC,validate binding 工作
//   - `nacpVersion()`        — return NACP versions(便于 cross-worker
//                               compat 自检)
//   - `contextOps()`         — return  worker 暴露的 op 名单;ZX5 后续 phase
//                               按业务驱动逐项 land
//
// 短期 shim 期(≤ 2 周)agent-core 仍保留 library import;cross-e2e 稳定
// 后(per Q6 + R9 时间盒化)再删除 library 依赖。
//
// ZX5 review (GLM R11): RPC op-list method renamed `assemblerOps` →
// `contextOps` so the {domain}Ops naming matches filesystem-core's
// `filesystemOps`. The legacy alias `assemblerOps` is kept on the class for
// any in-flight caller that bound to it during the Q6 short-term shim period
// and will be removed when agent-core flips to RPC-first.
export class ContextCoreEntrypoint extends WorkerEntrypoint<ContextCoreEnv> {
  async fetch(request: Request): Promise<Response> {
    return worker.fetch(request, this.env);
  }

  async probe(): Promise<{ status: "ok"; worker: "context-core"; worker_version: string }> {
    return {
      status: "ok",
      worker: "context-core",
      worker_version: this.env.WORKER_VERSION ?? `context-core@${this.env.ENVIRONMENT ?? "dev"}`,
    };
  }

  async nacpVersion(): Promise<{ nacp_core: string; nacp_session: string }> {
    return {
      nacp_core: NACP_VERSION,
      nacp_session: NACP_SESSION_VERSION,
    };
  }

  /**
   * Returns the supported context op names that agent-core can call via RPC
   * after Lane E migration completes. Current ZX5 list is the minimal seam
   * exposed by `@haimang/context-core-worker/context-api/*`;agent-core
   * adapter chooses RPC vs library import based on `CONTEXT_CORE_RPC_FIRST`
   * env flag(deploy-time toggle 期短期 shim period)。
   */
  async contextOps(): Promise<{ ops: string[] }> {
      return {
        ops: [
          "appendInitialContextLayer",
          "drainPendingInitialContextLayers",
          "peekPendingInitialContextLayers",
          "getContextProbe",
          "getContextLayers",
          "previewCompact",
          "getCompactJob",
          "getContextSnapshot",
          "triggerContextSnapshot",
          "triggerCompact",
        ],
      };
    }

  /** @deprecated Renamed to `contextOps()` per ZX5 review GLM R11. Kept as
   * an alias during the short-term shim period; remove when agent-core flips
   * to RPC-first. */
  async assemblerOps(): Promise<{ ops: string[] }> {
    return this.contextOps();
  }

  private requireOrchestratorCore(): OrchestratorCoreContextRpcLike {
    const binding = this.env.ORCHESTRATOR_CORE as OrchestratorCoreContextRpcLike | undefined;
    if (!binding) {
      throw new Error("ORCHESTRATOR_CORE binding missing");
    }
    return binding;
  }

  private async readDurableState(
    sessionUuid: string,
    teamUuid: string,
    meta: ContextBindingMeta,
  ): Promise<ContextDurableState> {
    const orchestrator = this.requireOrchestratorCore();
    if (typeof orchestrator.readContextDurableState !== "function") {
      throw new Error("ORCHESTRATOR_CORE.readContextDurableState missing");
    }
    const state = await orchestrator.readContextDurableState(sessionUuid, teamUuid, meta);
    if (!state) {
      throw new Error("context durable state unavailable");
    }
    return state;
  }

  async getContextProbe(
    sessionUuid: string,
    teamUuid: string,
    meta: ContextBindingMeta,
  ): Promise<Record<string, unknown>> {
    const state = await this.readDurableState(sessionUuid, teamUuid, meta);
    return buildContextProbe(state);
  }

  async getContextLayers(
    sessionUuid: string,
    teamUuid: string,
    meta: ContextBindingMeta,
  ): Promise<Record<string, unknown>> {
    const state = await this.readDurableState(sessionUuid, teamUuid, meta);
    return buildContextLayersResponse(state);
  }

  async previewCompact(
    sessionUuid: string,
    teamUuid: string,
    meta: ContextBindingMeta,
  ): Promise<Record<string, unknown>> {
    const state = await this.readDurableState(sessionUuid, teamUuid, meta);
    return buildCompactPreviewResponse(state);
  }

  async getCompactJob(
    sessionUuid: string,
    teamUuid: string,
    jobId: string,
    meta: ContextBindingMeta,
  ): Promise<Record<string, unknown>> {
    const orchestrator = this.requireOrchestratorCore();
    if (typeof orchestrator.readContextCompactJob !== "function") {
      throw new Error("ORCHESTRATOR_CORE.readContextCompactJob missing");
    }
    const job = await orchestrator.readContextCompactJob(sessionUuid, teamUuid, jobId, meta);
    if (!job) {
      throw new Error("compact job not found");
    }
    return job;
  }

  async getContextSnapshot(
    sessionUuid: string,
    teamUuid: string,
    meta: ContextBindingMeta,
  ): Promise<Record<string, unknown>> {
    const probe = await this.getContextProbe(sessionUuid, teamUuid, meta);
    return {
      ...probe,
      phase: "durable",
    };
  }

  async triggerContextSnapshot(
    sessionUuid: string,
    teamUuid: string,
    meta: ContextBindingMeta,
  ): Promise<Record<string, unknown>> {
    const orchestrator = this.requireOrchestratorCore();
    if (typeof orchestrator.createContextSnapshot !== "function") {
      throw new Error("ORCHESTRATOR_CORE.createContextSnapshot missing");
    }
    const state = await this.readDurableState(sessionUuid, teamUuid, meta);
    const created = await orchestrator.createContextSnapshot(
      sessionUuid,
      teamUuid,
      {
        trace_uuid: meta.trace_uuid,
        snapshot_kind: "manual-snapshot",
        prompt_token_estimate: state.usage
          ? state.usage.llm_input_tokens + state.usage.llm_output_tokens
          : null,
        payload: buildContextSnapshotPayload(state),
      },
      meta,
    );
    if (!created) {
      throw new Error("context snapshot write failed");
    }
    return {
      ...created,
      phase: "durable",
    };
  }

  async triggerCompact(
    sessionUuid: string,
    teamUuid: string,
    meta: ContextBindingMeta,
  ): Promise<Record<string, unknown>> {
    const orchestrator = this.requireOrchestratorCore();
    if (typeof orchestrator.commitContextCompact !== "function") {
      throw new Error("ORCHESTRATOR_CORE.commitContextCompact missing");
    }
    const state = await this.readDurableState(sessionUuid, teamUuid, meta);
    const input = buildCompactCommitInput(state);
    if (!input.need_compact || input.summary_text.length === 0) {
      return {
        session_uuid: sessionUuid,
        team_uuid: teamUuid,
        compacted: false,
        before_size: input.tokens_before,
        after_size: input.tokens_before,
        phase: "durable",
        reason: "compact-not-needed",
      };
    }
    const result = await orchestrator.commitContextCompact(
      sessionUuid,
      teamUuid,
      {
        trace_uuid: meta.trace_uuid,
        tokens_before: input.tokens_before,
        tokens_after: input.tokens_after,
        prompt_token_estimate: input.prompt_token_estimate,
        summary_text: input.summary_text,
        message_high_watermark: input.message_high_watermark,
        protected_fragment_kinds: input.protected_fragment_kinds,
        compacted_message_count: input.compacted_message_count,
        kept_message_count: input.kept_message_count,
      },
      meta,
    );
    if (!result) {
      throw new Error("context compact write failed");
    }
    if ("status" in result && result.status === "blocked") {
      return {
        session_uuid: sessionUuid,
        team_uuid: teamUuid,
        compacted: false,
        before_size: input.tokens_before,
        after_size: input.tokens_before,
        phase: "durable",
        reason: result.reason,
      };
    }
    return {
      session_uuid: sessionUuid,
      team_uuid: teamUuid,
      compacted: true,
      before_size: input.tokens_before,
      after_size: input.tokens_after,
      phase: "durable",
      job: result,
    };
  }
}

export type { ContextCoreEnv };
// Named export for tests and internal callers that need the raw fetch handler.
export { worker as fetchWorker };
// ZX5 Lane E: WorkerEntrypoint as the default so Cloudflare Workers runtime
// exposes RPC methods via service binding. The fetch path is preserved via
// ContextCoreEntrypoint.fetch() which delegates to the `worker` object.
export default ContextCoreEntrypoint;
