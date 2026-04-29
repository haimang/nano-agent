/**
 * RH0 P0-D1 — preview verification subsystem extracted from `nano-session-do.ts`.
 *
 * 这层只负责 `runPreviewVerification` dispatcher 与 5 个 verify check 的实现:
 *   - capability-call / capability-cancel / initial-context / compact-posture /
 *     filesystem-posture
 *
 * 不引入新行为,仅按 charter §7.1 把 ≥355 行的 verify 实现从 megafile 迁出。
 * NanoSessionDO 的 private 字段不再下沉到本文件;相反 verify 函数通过
 * 一个 narrow `VerifyContext` 接口拿到所需的 5 个最小访问点(subsystems /
 * env / quotaAuthorizer / buildQuotaContext / buildCrossSeamAnchor)。
 *
 * 来源:截至 2026-04-29 main snapshot 的 `nano-session-do.ts:1723-2077`(≈ 355 行)。
 */

import type { CapabilityTransportLike } from "../runtime-mainline.js";
import type { CrossSeamAnchor } from "../cross-seam.js";
import type { SubsystemHandles } from "../composition.js";
import type { QuotaAuthorizer, QuotaRuntimeContext } from "../quota/authorizer.js";
import { QuotaExceededError } from "../quota/authorizer.js";
import {
  buildQuotaErrorEnvelope,
  buildToolQuotaAuthorization,
} from "../runtime-mainline.js";
import { peekPendingInitialContextLayers } from "@haimang/context-core-worker/context-api/append-initial-context-layer";

/**
 * Minimum surface verify subsystem reads from NanoSessionDO. NanoSessionDO
 * exposes these via internal accessors named `_internal_verify_*` — they are
 * `public` only because TS modules need them, **not** part of any external API.
 */
export interface VerifyContext {
  readonly subsystems: SubsystemHandles;
  readonly env: unknown;
  readonly quotaAuthorizer: QuotaAuthorizer | null;
  buildQuotaContext(turnUuid?: string | null): QuotaRuntimeContext | null;
  buildCrossSeamAnchor(): CrossSeamAnchor | undefined;
}

/**
 * Resolve the live capability transport from the composed subsystems handle.
 * Returns undefined if the capability subsystem has no service-binding
 * transport wired (e.g. local-only test factory).
 */
export function getCapabilityTransport(ctx: VerifyContext):
  | CapabilityTransportLike
  | {
      call: (input: {
        requestId: string;
        capabilityName: string;
        body: unknown;
        anchor?: CrossSeamAnchor;
        quota?: Record<string, unknown>;
        signal?: AbortSignal;
      }) => Promise<unknown>;
      cancel?: (input: {
        requestId: string;
        body: unknown;
        anchor?: CrossSeamAnchor;
      }) => Promise<void>;
    }
  | undefined {
  const capability = ctx.subsystems.capability as
    | {
        serviceBindingTransport?: {
          call?: (input: unknown) => Promise<unknown>;
          cancel?: (input: unknown) => Promise<void>;
        };
      }
    | undefined;
  const transport = capability?.serviceBindingTransport;
  if (typeof transport?.call !== "function") {
    return undefined;
  }
  return {
    // ZX4 Phase 1 P1-01(R28 fix): call input 接口加 signal — 让
    // verifyCapabilityCancel 可通过 AbortController 同请求生命周期取消,
    // 不再依赖独立 transport.cancel(per Q1 修订 — 结果约束)
    call: transport.call.bind(transport) as (input: {
      requestId: string;
      capabilityName: string;
      body: unknown;
      anchor?: CrossSeamAnchor;
      quota?: Record<string, unknown>;
      signal?: AbortSignal;
    }) => Promise<unknown>,
    cancel:
      typeof transport.cancel === "function"
        ? (transport.cancel.bind(transport) as (input: {
            requestId: string;
            body: unknown;
            anchor?: CrossSeamAnchor;
          }) => Promise<void>)
        : undefined,
  };
}

async function verifyCapabilityCall(
  ctx: VerifyContext,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const transport = getCapabilityTransport(ctx);
  if (!transport) {
    return {
      check: "capability-call",
      error: "capability-transport-unavailable",
    };
  }

  const toolName =
    typeof request.toolName === "string" ? request.toolName : "pwd";
  const toolInput =
    request.toolInput && typeof request.toolInput === "object"
      ? request.toolInput
      : {};
  const requestId = `verify-call-${crypto.randomUUID()}`;
  const quotaContext = ctx.buildQuotaContext();
  let quota: Record<string, unknown> | undefined;
  try {
    quota = await buildToolQuotaAuthorization(
      ctx.quotaAuthorizer,
      quotaContext,
      requestId,
      toolName,
    );
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return {
        check: "capability-call",
        toolName,
        response: buildQuotaErrorEnvelope(error),
      };
    }
    throw error;
  }
  const response = await transport.call({
    requestId,
    capabilityName: toolName,
    body: {
      tool_name: toolName,
      tool_input: toolInput,
    },
    anchor: ctx.buildCrossSeamAnchor(),
    quota,
  });

  return {
    check: "capability-call",
    toolName,
    response,
  };
}

// ZX4 Phase 1 P1-01(R28 fix per ZX4-ZX5 GPT review Q1 修订 — 结果约束):
// 修复 deploy-only bug: `verifyCapabilityCancel` 在 CF Workers 真 deploy 触发
// I/O cross-request 隔离(`Object.cancel` index.js:8796 — workerd-test 看不见)。
// 新实现满足 Q1 修订结果约束: 取消与执行处于同一请求生命周期 / 同一运行链条;
// 不依赖第二条独立 cancel request 作为 preview 主路径。
async function verifyCapabilityCancel(
  ctx: VerifyContext,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const requestId = `verify-cancel-${crypto.randomUUID()}`;
  const ms =
    typeof request.ms === "number" && Number.isFinite(request.ms)
      ? Math.max(50, Math.min(5_000, Math.trunc(request.ms)))
      : 400;
  const cancelAfterMs =
    typeof request.cancelAfterMs === "number" && Number.isFinite(request.cancelAfterMs)
      ? Math.max(1, Math.min(ms - 1, Math.trunc(request.cancelAfterMs)))
      : 25;
  // ZX4 Phase 7 P7-C deploy fix: outer try/catch covers the WHOLE verify path.
  try {
    const transport = getCapabilityTransport(ctx);
    if (!transport?.call) {
      return {
        check: "capability-cancel",
        error: "capability-cancel-unavailable",
      };
    }

    const quotaContext = ctx.buildQuotaContext();
    let quota: Record<string, unknown> | undefined;
    try {
      quota = await buildToolQuotaAuthorization(
        ctx.quotaAuthorizer,
        quotaContext,
        requestId,
        "__px_sleep",
      );
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        return {
          check: "capability-cancel",
          requestId,
          response: buildQuotaErrorEnvelope(error),
        };
      }
      throw error;
    }

    // R28 fix: 同请求生命周期 AbortController(替代独立 transport.cancel)
    const abortController = new AbortController();
    const callPromise = transport.call({
      requestId,
      capabilityName: "__px_sleep",
      body: {
        tool_name: "__px_sleep",
        tool_input: { ms },
      },
      anchor: ctx.buildCrossSeamAnchor(),
      quota,
      signal: abortController.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, cancelAfterMs));
    try {
      abortController.abort("preview verification cancel");
    } catch {
      // older runtimes may reject string reason — ignore, signal still aborted
    }

    const response = await callPromise.catch((err) => {
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" || /aborted|cancelled/i.test(err.message));
      return {
        status: "error",
        error: {
          code: isAbort ? "cancelled" : "transport-error",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    });
    const cancelHonored =
      response !== null &&
      typeof response === "object" &&
      "status" in response &&
      (response as { status?: unknown }).status === "error" &&
      "error" in response &&
      typeof (response as { error?: unknown }).error === "object" &&
      (response as { error?: { code?: unknown } }).error?.code === "cancelled";

    return {
      check: "capability-cancel",
      requestId,
      ms,
      cancelAfterMs,
      cancelRequested: true,
      cancelHonored,
      response,
    };
  } catch (error) {
    return {
      check: "capability-cancel",
      requestId,
      ms,
      cancelAfterMs,
      cancelRequested: true,
      cancelHonored: false,
      response: {
        status: "error",
        error: {
          code: "verify-cancel-internal",
          message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        },
      },
    };
  }
}

// ZX4 Phase 1 P1-02 (R29 fix): only deterministic computed fields.
function verifyInitialContext(ctx: VerifyContext): Record<string, unknown> {
  const workspace = ctx.subsystems.workspace as
    | {
        assembler?: {
          assemble: (layers: readonly unknown[]) => {
            readonly assembled: Array<{ readonly kind: string }>;
            readonly totalTokens: number;
          };
        };
      }
    | undefined;
  const assembler = workspace?.assembler;
  if (!assembler) {
    return {
      check: "initial-context",
      error: "assembler-unavailable",
    };
  }

  const pending = peekPendingInitialContextLayers(assembler as never);
  const assembled = assembler.assemble(pending as never);
  return {
    check: "initial-context",
    pendingCount: pending.length,
    assembledKinds: assembled.assembled.map((layer) => layer.kind),
    totalTokens: assembled.totalTokens,
  };
}

function verifyCompactPosture(ctx: VerifyContext): Record<string, unknown> {
  const kernel = ctx.subsystems.kernel as
    | { phase?: string; reason?: string }
    | undefined;
  return {
    check: "compact-posture",
    compactDefaultMounted: false,
    kernelPhase: kernel?.phase ?? null,
    kernelReason: kernel?.reason ?? null,
    profile: ctx.subsystems.profile,
  };
}

function verifyFilesystemPosture(ctx: VerifyContext): Record<string, unknown> {
  const storage = ctx.subsystems.storage as
    | { phase?: string; reason?: string }
    | undefined;
  const env = ctx.env as
    | { FILESYSTEM_CORE?: unknown; BASH_CORE?: unknown }
    | undefined;
  return {
    check: "filesystem-posture",
    hostLocalFilesystem: true,
    filesystemBindingActive: Boolean(env?.FILESYSTEM_CORE),
    capabilityBindingActive: Boolean(env?.BASH_CORE),
    storagePhase: storage?.phase ?? null,
    storageReason: storage?.reason ?? null,
    profile: ctx.subsystems.profile,
  };
}

/**
 * Dispatcher — invoked from NanoSessionDO.runPreviewVerification thin wrapper.
 */
export async function runPreviewVerification(
  ctx: VerifyContext,
  _sessionId: string,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const check = typeof request.check === "string" ? request.check : "";

  switch (check) {
    case "capability-call":
      return verifyCapabilityCall(ctx, request);
    case "capability-cancel":
      return verifyCapabilityCancel(ctx, request);
    case "initial-context":
      return verifyInitialContext(ctx);
    case "compact-posture":
      return verifyCompactPosture(ctx);
    case "filesystem-posture":
      return verifyFilesystemPosture(ctx);
    default:
      return {
        check,
        error: "unknown-verify-check",
        supported: [
          "capability-call",
          "capability-cancel",
          "initial-context",
          "compact-posture",
          "filesystem-posture",
        ],
      };
  }
}
