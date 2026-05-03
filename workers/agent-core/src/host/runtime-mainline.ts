import type { CrossSeamAnchor } from "./cross-seam.js";
import { KernelRunner } from "../kernel/runner.js";
import type { AiBindingLike } from "../llm/adapters/workers-ai.js";
import {
  WorkersAiGateway,
  buildWorkersAiExecutionRequestFromMessages,
  loadWorkersAiModelCapabilities,
} from "../llm/gateway.js";
import { QuotaAuthorizer, type QuotaRuntimeContext } from "./quota/authorizer.js";
import type { HookDispatcher, HookEmitContext } from "../hooks/dispatcher.js";
import type { HookEventName } from "../hooks/catalog.js";
import {
  createCapabilityAdapter,
  type CapabilityTransportLike,
} from "./runtime-capability.js";

export {
  buildQuotaErrorEnvelope,
  buildToolQuotaAuthorization,
  type CapabilityTransportLike,
} from "./runtime-capability.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export interface MainlineKernelOptions {
  readonly ai: AiBindingLike;
  readonly quotaAuthorizer: QuotaAuthorizer | null;
  readonly capabilityTransport?: CapabilityTransportLike;
  readonly modelCatalogDb?: D1Database;
  readonly sessionFileReader?: {
    readArtifact?(
      input: {
        readonly team_uuid: string;
        readonly session_uuid: string;
        readonly file_uuid: string;
      },
      meta?: { readonly trace_uuid?: string; readonly team_uuid?: string },
    ): Promise<{
      readonly file: { readonly mime?: string | null };
      readonly bytes: ArrayBuffer;
    } | null>;
  };
  readonly contextProvider: () => QuotaRuntimeContext | null;
  readonly anchorProvider: () => CrossSeamAnchor | undefined;
  /**
   * ZX5 Lane F3 — runtime usage push:在每次 LLM/tool quota commit 后回调。
   * Caller 的 NanoSessionDO 通过此 hook 取得 quota balance 与 commit 增量,
   * 然后通过 emitServerFrame 推 `session.usage.update` 给 attached client。
   * undefined 表示 deploy 还未接 push(向下兼容)。
   */
  readonly onUsageCommit?: (event: {
    readonly kind: "llm" | "tool";
    readonly remaining: number;
    readonly limitValue: number;
    readonly detail: Record<string, unknown>;
  }) => void;
  /**
   * RH1 P1-02 — wire `hook.emit` delegate to a real HookDispatcher.
   * undefined → preserves the historical no-op (deploy-time backward compat
   * with hosts that haven't seeded the dispatcher yet).
   */
  readonly hookDispatcher?: HookDispatcher;
  /**
   * Provider for per-emit context (sessionUuid / turnId / abortSignal).
   * Without it, dispatcher gets {} — guards still apply.
   */
  readonly hookContextProvider?: () => HookEmitContext;
  /**
   * RH2 P2-12 — runtime tool semantic streaming hook. NanoSessionDO wires
   * this to push `llm.delta {content_type:"tool_use_start"|"tool_use_delta"}`
   * + `tool.call.result` frames to the client. Best-effort:undefined 时
   * runtime 不发 tool semantic frame(向下兼容)。
   */
  readonly onToolEvent?: (event: ToolSemanticEvent) => void;
  /**
   * HP3-D2 (deferred-closure absorb) — host-supplied compact budget probe.
   * The orchestrator polls this between every kernel step. When it
   * returns `true`, the scheduler emits a `compact` decision (see
   * `kernel/scheduler.ts:50`).
   *
   * Callers should compose the probe with
   * `createCompactBreaker()` (HP3-D4) so 3 consecutive failed compacts
   * suppress further attempts within the same session.
   */
  readonly compactSignalProbe?: () => Promise<boolean> | boolean;
  /**
   * HPX5 F2b — WriteTodos backend. When LLM emits
   * `tool_use { name: "write_todos" }` the capability runner short-circuits
   * the regular capabilityTransport and calls this instead. The host wires
   * this to `env.ORCHESTRATOR_CORE.writeTodos` (orchestrator-core entrypoint
   * RPC). Optional — when absent the tool falls back to `capabilityTransport`
   * (which will return capability-not-found for unknown tools).
   */
  readonly writeTodosBackend?: (input: {
    readonly session_uuid: string;
    readonly conversation_uuid: string;
    readonly team_uuid: string;
    readonly user_uuid: string;
    readonly trace_uuid: string;
    readonly todos: ReadonlyArray<{
      readonly content: string;
      readonly status?: "pending" | "in_progress" | "completed" | "cancelled" | "blocked";
      readonly parent_todo_uuid?: string | null;
    }>;
  }) => Promise<
    | {
        readonly ok: true;
        readonly created: ReadonlyArray<{
          readonly todo_uuid: string;
          readonly status: "pending" | "in_progress" | "completed" | "cancelled" | "blocked";
        }>;
        readonly auto_closed: ReadonlyArray<{ readonly todo_uuid: string }>;
      }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >;
  readonly authorizeToolUse?: (input: {
    readonly session_uuid: string;
    readonly team_uuid: string;
    readonly tool_name: string;
    readonly tool_input?: Record<string, unknown>;
  }, meta?: { readonly trace_uuid?: string; readonly team_uuid?: string }) => Promise<{
    readonly ok: boolean;
    readonly decision: "allow" | "deny" | "ask";
    readonly source: "session-rule" | "tenant-rule" | "approval-policy" | "unavailable";
    readonly reason?: string;
  }>;
  readonly requestToolPermission?: (input: {
    readonly session_uuid: string;
    readonly team_uuid: string;
    readonly trace_uuid: string;
    readonly request_uuid: string;
    readonly tool_name: string;
    readonly tool_input: Record<string, unknown>;
    readonly reason?: string;
  }) => Promise<Record<string, unknown>>;
  readonly requestCompact?: (input: {
    readonly session_uuid: string;
    readonly team_uuid: string;
    readonly trace_uuid: string;
    readonly total_tokens: number;
    readonly messages: readonly unknown[];
  }) => Promise<{
    readonly tokensFreed: number;
    readonly messages?: readonly unknown[];
    readonly degraded?: { readonly code?: string; readonly message?: string };
  }>;
}

// HP3-D2 / HP3-D4 (deferred-closure absorb) — compact signal probe + breaker
// implementations live in `compact-breaker.ts` to keep this file within
// its HP8 megafile budget (Q25). Re-export so existing importers see
// no API change.
export {
  createCompactBreaker,
  composeCompactSignalProbe,
  type CompactBreaker,
} from "./compact-breaker.js";

export interface ToolSemanticEvent {
  readonly kind:
    | "tool_use_start"
    | "tool_use_delta"
    | "tool_call_result"
    | "tool_call_cancelled";
  readonly tool_call_id: string;
  readonly tool_name: string;
  readonly tool_input?: Record<string, unknown>;
  readonly args_chunk?: string;
  readonly status?: "ok" | "error";
  readonly output?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
  readonly cancel_initiator?: "user" | "system" | "parent_cancel";
  readonly reason?: string;
}

export const NANO_AGENT_SYSTEM_PROMPT =
  "You are nano-agent running inside Cloudflare Workers, not a Linux VM. " +
  "Use the provided tools as a governed fake-bash capability layer; do not assume POSIX shell, local OS access, or unsupported commands. " +
  "Prefer structured tool calls for filesystem, search, network, TypeScript execution, and git tasks, and surface unsupported capability needs explicitly.";

const MODEL_PROMPT_SUFFIX_CACHE = new Map<string, string>();

export function primeModelPromptSuffix(modelId: string, suffix: string | null | undefined): void {
  if (!modelId) return;
  if (typeof suffix === "string" && suffix.length > 0) {
    MODEL_PROMPT_SUFFIX_CACHE.set(modelId, suffix);
    return;
  }
  MODEL_PROMPT_SUFFIX_CACHE.delete(modelId);
}

export function resetModelPromptSuffixCache(): void {
  MODEL_PROMPT_SUFFIX_CACHE.clear();
}

// HP0 P3-01 — model-aware seam:HP1 落 `nano_models.base_instructions_suffix`
// 后,本函数会在 NANO_AGENT_SYSTEM_PROMPT 之后接入 per-model suffix。HP0 阶段
// 不读取 D1,`modelId` 仅用于占位/接缝,行为与无参版本等价(见 HP0-closure §2 P1
// 与 `expires-at: HP1 closure` 法律)。后续 phase 不应再调整本函数的形参集。
// Exported for HP0 system-prompt seam regression(see
// `test/host/system-prompt-seam.test.ts`)。HP1 真值落表后,此函数会同样被
// runtime-mainline 内部消费;不需要再调整 API 边界。
export function withNanoAgentSystemPrompt(
  messages: readonly unknown[],
  modelId?: string,
): readonly unknown[] {
  const hasSystemPrompt = messages.some(
    (message) =>
      isRecord(message) &&
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.length > 0,
  );
  if (hasSystemPrompt) return messages;
  const suffix = modelId ? MODEL_PROMPT_SUFFIX_CACHE.get(modelId) : undefined;
  const content =
    typeof suffix === "string" && suffix.length > 0
      ? `${NANO_AGENT_SYSTEM_PROMPT}\n\n${suffix}`
      : NANO_AGENT_SYSTEM_PROMPT;
  return [{ role: "system", content }, ...messages];
}

function readLlmRequestEvidence(messages: readonly unknown[]): {
  readonly modelId: string;
  readonly reasoning: { readonly effort: "low" | "medium" | "high" } | undefined;
  readonly isReasoning: boolean;
  readonly isVision: boolean;
} {
  const defaultModel = "@cf/ibm-granite/granite-4.0-h-micro";
  let modelId = defaultModel;
  let reasoning: { readonly effort: "low" | "medium" | "high" } | undefined;
  let isVision = false;
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const explicitModelId =
      typeof message.model_id === "string" && message.model_id.length > 0
        ? message.model_id
        : typeof message.modelId === "string" && message.modelId.length > 0
          ? message.modelId
          : null;
    if (explicitModelId) {
      modelId = explicitModelId;
    }
    if (!reasoning) {
      const effort: "low" | "medium" | "high" | undefined =
        isRecord(message.reasoning) &&
        (message.reasoning.effort === "low" ||
          message.reasoning.effort === "medium" ||
          message.reasoning.effort === "high")
          ? message.reasoning.effort
          : undefined;
      reasoning = effort ? { effort } : undefined;
    }
    if (!isVision) {
      const content = Array.isArray(message.content) ? message.content : [];
      const parts = Array.isArray(message.parts) ? message.parts : [];
      isVision = [...content, ...parts].some(
        (part) => isRecord(part) && part.kind === "image_url",
      );
    }
  }
  return { modelId, reasoning, isReasoning: Boolean(reasoning), isVision };
}

async function readModelPromptSuffix(
  db: D1Database,
  modelId: string,
): Promise<string | null> {
  const row = await db.prepare(
    `SELECT base_instructions_suffix
       FROM nano_models
      WHERE model_id = ?1
      LIMIT 1`,
  ).bind(modelId).first<{ base_instructions_suffix: string | null }>();
  return typeof row?.base_instructions_suffix === "string" && row.base_instructions_suffix.length > 0
    ? row.base_instructions_suffix
    : null;
}

function parseSessionFileImageUrl(
  rawUrl: string,
): { readonly sessionUuid: string; readonly fileUuid: string } | null {
  const path = (() => {
    if (rawUrl.startsWith("nano-file://")) {
      const withoutScheme = rawUrl.slice("nano-file://".length);
      const [sessionUuid, fileUuid] = withoutScheme.split("/");
      return sessionUuid && fileUuid ? `/sessions/${sessionUuid}/files/${fileUuid}/content` : rawUrl;
    }
    if (rawUrl.startsWith("/")) return rawUrl;
    try {
      return new URL(rawUrl).pathname;
    } catch {
      return rawUrl;
    }
  })();
  const match = /^\/sessions\/([^/]+)\/files\/([^/]+)\/content$/.exec(path);
  return match ? { sessionUuid: match[1], fileUuid: match[2] } : null;
}

function arrayBufferToBase64(bytes: ArrayBuffer): string {
  let binary = "";
  const view = new Uint8Array(bytes);
  const chunkSize = 0x8000;
  for (let offset = 0; offset < view.length; offset += chunkSize) {
    const chunk = view.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function resolveSessionFileImages(
  messages: readonly unknown[],
  options: MainlineKernelOptions,
): Promise<readonly unknown[]> {
  if (!options.sessionFileReader?.readArtifact) return messages;
  const context = options.contextProvider();
  if (!context) return messages;
  const out: unknown[] = [];
  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.content)) {
      out.push(message);
      continue;
    }
    const content: unknown[] = [];
    for (const part of message.content) {
      if (!isRecord(part) || part.kind !== "image_url" || typeof part.url !== "string") {
        content.push(part);
        continue;
      }
      const parsed = parseSessionFileImageUrl(part.url);
      if (!parsed) {
        content.push(part);
        continue;
      }
      const artifact = await options.sessionFileReader.readArtifact(
        {
          team_uuid: context.teamUuid,
          session_uuid: parsed.sessionUuid,
          file_uuid: parsed.fileUuid,
        },
        { trace_uuid: context.traceUuid, team_uuid: context.teamUuid },
      );
      if (!artifact) {
        throw new Error(`session file image not found: ${parsed.fileUuid}`);
      }
      const mime =
        typeof artifact.file.mime === "string" && artifact.file.mime.length > 0
          ? artifact.file.mime
          : typeof part.mime === "string" && part.mime.length > 0
            ? part.mime
            : "application/octet-stream";
      content.push({
        ...part,
        url: `data:${mime};base64,${arrayBufferToBase64(artifact.bytes)}`,
        mime,
      });
    }
    out.push({ ...message, content });
  }
  return out;
}

export function createMainlineKernelRunner(
  options: MainlineKernelOptions,
): KernelRunner {
  const llmRequestIds = new Map<string, string>();
  const llmEvidenceByTurn = new Map<string, ReturnType<typeof readLlmRequestEvidence>>();
  const inflightToolCalls = new Map<string, { readonly toolName: string }>();
  const gateway = new WorkersAiGateway(options.ai);
  let llmRequestSequence = 0;
  const runner = new KernelRunner(
    {
      llm: {
        async *call(request: unknown) {
          const messages = Array.isArray(request) ? request : [];
          const evidence = readLlmRequestEvidence(messages);
          const resolvedMessages = await resolveSessionFileImages(messages, options);
          const promptSuffix =
            options.modelCatalogDb && evidence.modelId
              ? await readModelPromptSuffix(options.modelCatalogDb, evidence.modelId)
              : null;
          primeModelPromptSuffix(evidence.modelId, promptSuffix);
          const modelCapabilities = options.modelCatalogDb
            ? await loadWorkersAiModelCapabilities(options.modelCatalogDb)
            : undefined;
          const exec = buildWorkersAiExecutionRequestFromMessages({
            // HP0 P3-01 — 把 `evidence.modelId` 显式传到 seam,HP1 落表后此处直接读 suffix。
            messages: withNanoAgentSystemPrompt(resolvedMessages, evidence.modelId),
            tools: true,
            modelCapabilities,
            modelId: evidence.modelId,
            reasoning: evidence.reasoning,
          });
          for (const [turnId] of llmRequestIds) {
            llmEvidenceByTurn.set(turnId, evidence);
          }
          for await (const event of gateway.executeStream(exec)) {
            switch (event.type) {
              case "delta":
                yield {
                  type: "content" as const,
                  content: event.content,
                };
                break;
              case "tool_call":
                yield {
                  type: "tool_calls" as const,
                  calls: [
                    {
                      id: event.id,
                      name: event.name,
                      input: (() => {
                        try {
                          return JSON.parse(event.arguments);
                        } catch {
                          return event.arguments;
                        }
                      })(),
                    },
                  ],
                };
                break;
              case "finish":
                yield {
                  type: "usage" as const,
                  usage: {
                    inputTokens: event.usage.inputTokens,
                    outputTokens: event.usage.outputTokens,
                  },
                };
                break;
              case "error":
                throw new Error(event.error.message);
              default:
                break;
            }
          }
        },
        abort() {},
      },
      capability: createCapabilityAdapter(options, inflightToolCalls),
      hook: {
        // RH1 P1-02 — real delegate. dispatcher 不在时退化为 no-op(向下兼容
        // 测试 fixture);注入后,blocking 类型 hook 失败必须 throw 而非 silent。
        async emit(event: string, payload: unknown) {
          const dispatcher = options.hookDispatcher;
          if (!dispatcher) return undefined;
          const context = options.hookContextProvider?.();
          const outcome = await dispatcher.emit(
            event as HookEventName,
            payload,
            context,
          );
          if (outcome.blocked) {
            throw new Error(
              `hook ${event} blocked: ${outcome.blockReason ?? "no reason"}`,
            );
          }
          return outcome;
        },
      },
      compact: {
        async requestCompact(budget: unknown) {
          const ctx = options.contextProvider();
          const record = isRecord(budget) ? budget : {};
          const totalTokens =
            typeof record.totalTokens === "number" && Number.isFinite(record.totalTokens)
              ? Math.max(0, Math.trunc(record.totalTokens))
              : 0;
          const messages = Array.isArray(record.messages) ? record.messages : [];
          if (!ctx || !options.requestCompact) {
            return {
              tokensFreed: 0,
              degraded: {
                code: "context-compact-unavailable",
                message: "runtime compact bridge unavailable",
              },
            };
          }
          const result = await options.requestCompact({
            session_uuid: ctx.sessionUuid,
            team_uuid: ctx.teamUuid,
            trace_uuid: ctx.traceUuid,
            total_tokens: totalTokens,
            messages,
          });
          return {
            tokensFreed: Math.max(0, Math.trunc(result.tokensFreed)),
            ...(Array.isArray(result.messages)
              ? { messages: [...result.messages] }
              : {}),
            ...(result.degraded ? { degraded: result.degraded } : {}),
          };
        },
      },
    },
    {
      beforeLlmInvoke: async ({ turnId }) => {
        const context = options.contextProvider();
        if (!options.quotaAuthorizer || !context) return;
        const requestId = `llm-${turnId}-${llmRequestSequence + 1}`;
        await options.quotaAuthorizer.authorize("llm", context, requestId, {
          provider_key: "workers-ai",
        });
        llmRequestSequence += 1;
        llmRequestIds.set(turnId, requestId);
      },
      afterLlmInvoke: async ({ turnId, usage }) => {
        const context = options.contextProvider();
        if (!options.quotaAuthorizer || !context) return;
        const requestId = llmRequestIds.get(turnId);
        if (!requestId) return;
        llmRequestIds.delete(turnId);
        const balance = await options.quotaAuthorizer.commit("llm", context, requestId, {
          provider_key: "workers-ai",
          model_id: (llmEvidenceByTurn.get(turnId) ?? readLlmRequestEvidence([])).modelId,
          request_uuid: requestId,
          input_tokens: usage?.inputTokens ?? 0,
          output_tokens: usage?.outputTokens ?? 0,
          estimated_cost_usd: 0,
          is_reasoning: (llmEvidenceByTurn.get(turnId) ?? readLlmRequestEvidence([])).isReasoning,
          is_vision: (llmEvidenceByTurn.get(turnId) ?? readLlmRequestEvidence([])).isVision,
        });
        const evidence = llmEvidenceByTurn.get(turnId) ?? readLlmRequestEvidence([]);
        llmEvidenceByTurn.delete(turnId);
        // ZX5 F3 — emit `session.usage.update` server frame after commit
        options.onUsageCommit?.({
          kind: "llm",
          remaining: balance.remaining,
          limitValue: balance.limitValue,
          detail: {
            provider_key: "workers-ai",
            model_id: evidence.modelId,
            request_uuid: requestId,
            input_tokens: usage?.inputTokens ?? 0,
            output_tokens: usage?.outputTokens ?? 0,
            estimated_cost_usd: 0,
            is_reasoning: evidence.isReasoning,
            is_vision: evidence.isVision,
            turn_id: turnId,
          },
        });
      },
    },
  );

  return runner;
}
