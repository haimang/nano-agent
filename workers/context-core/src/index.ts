import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { ContextCoreEnv, ContextCoreShellResponse } from "./types.js";

function createShellResponse(env: ContextCoreEnv): ContextCoreShellResponse {
  return {
    worker: "context-core",
    nacp_core_version: NACP_VERSION,
    nacp_session_version: NACP_SESSION_VERSION,
    status: "ok",
    worker_version: env.WORKER_VERSION ?? `context-core@${env.ENVIRONMENT ?? "dev"}`,
    phase: "worker-matrix-P3-absorbed",
    absorbed_runtime: true,
    library_worker: true,
  };
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
function bindingScopeForbidden(): Response {
  return Response.json(
    {
      error: "binding-scope-forbidden",
      message:
        "context-core is a library-only worker; runtime code is consumed in-process by agent-core",
      worker: "context-core",
    },
    { status: 401 },
  );
}

const worker = {
  async fetch(request: Request, env: ContextCoreEnv): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (method === "GET" && (pathname === "/" || pathname === "/health")) {
      return Response.json(createShellResponse(env));
    }

    return bindingScopeForbidden();
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
      ],
    };
  }

  /** @deprecated Renamed to `contextOps()` per ZX5 review GLM R11. Kept as
   * an alias during the short-term shim period; remove when agent-core flips
   * to RPC-first. */
  async assemblerOps(): Promise<{ ops: string[] }> {
    return this.contextOps();
  }

  // ──────────────────────────────────────────────────────────────────
  // RH2 P2-05 / P2-06 / P2-07 — context inspection RPCs.
  //
  // 这 3 个 RPC 是 orchestrator-core 经 CONTEXT_CORE service binding 调用的
  // 入口点。当前 RH2 阶段 context-core 内部还没有真实 per-session DO
  // (那是 RH4 / RH6 工作),所以本 RPC 返回结构化 stub 形状(满足 endpoint 测试
  // + façade 真投递),但显式标注 `phase: "stub"` 让 client 与监控可见。
  //
  // 真实 per-session inspector 在 RH4 file pipeline 落地后接入,届时把这 3
  // 个 method 改为读取 `inspector-facade` 的真 snapshot/compact 接口。
  // ──────────────────────────────────────────────────────────────────

  async getContextSnapshot(
    sessionUuid: string,
    teamUuid: string,
    meta: { trace_uuid: string; team_uuid: string },
  ): Promise<{
    session_uuid: string;
    team_uuid: string;
    status: string;
    summary: string;
    artifacts_count: number;
    need_compact: boolean;
    phase: string;
  }> {
    void meta;
    return {
      session_uuid: sessionUuid,
      team_uuid: teamUuid,
      status: "ready",
      summary: "context-core RH2 stub: per-session inspector in RH4",
      artifacts_count: 0,
      need_compact: false,
      phase: "stub",
    };
  }

  async triggerContextSnapshot(
    sessionUuid: string,
    teamUuid: string,
    meta: { trace_uuid: string; team_uuid: string },
  ): Promise<{
    session_uuid: string;
    team_uuid: string;
    snapshot_id: string;
    created_at: string;
    phase: string;
  }> {
    void meta;
    return {
      session_uuid: sessionUuid,
      team_uuid: teamUuid,
      snapshot_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      phase: "stub",
    };
  }

  async triggerCompact(
    sessionUuid: string,
    teamUuid: string,
    meta: { trace_uuid: string; team_uuid: string },
  ): Promise<{
    session_uuid: string;
    team_uuid: string;
    compacted: boolean;
    before_size: number;
    after_size: number;
    phase: string;
  }> {
    void meta;
    return {
      session_uuid: sessionUuid,
      team_uuid: teamUuid,
      compacted: true,
      before_size: 0,
      after_size: 0,
      phase: "stub",
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
