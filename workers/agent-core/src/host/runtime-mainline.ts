import type { CrossSeamAnchor } from "./cross-seam.js";
import { KernelRunner } from "../kernel/runner.js";
import type { AiBindingLike } from "../llm/adapters/workers-ai.js";
import {
  WorkersAiGateway,
  buildWorkersAiExecutionRequestFromMessages,
} from "../llm/gateway.js";
import { QuotaAuthorizer, QuotaExceededError, type QuotaRuntimeContext } from "./quota/authorizer.js";
import type { HookDispatcher, HookEmitContext } from "../hooks/dispatcher.js";
import type { HookEventName } from "../hooks/catalog.js";

export interface CapabilityTransportLike {
  call(input: {
    readonly requestId: string;
    readonly capabilityName: string;
    readonly body: unknown;
    readonly anchor?: CrossSeamAnchor;
    readonly quota?: Record<string, unknown>;
  }): Promise<unknown>;
  cancel?(input: {
    readonly requestId: string;
    readonly body: unknown;
    readonly anchor?: CrossSeamAnchor;
  }): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseCapabilityEnvelope(result: unknown):
  | { status: "ok"; output: string }
  | { status: "error"; error: { code: string; message: string } } {
  if (!isRecord(result)) {
    return {
      status: "error",
      error: {
        code: "invalid-capability-response",
        message: "capability transport returned a non-object envelope",
      },
    };
  }
  if (result.status === "ok") {
    return {
      status: "ok",
      output: typeof result.output === "string" ? result.output : "",
    };
  }
  const error = isRecord(result.error) ? result.error : {};
  return {
    status: "error",
    error: {
      code:
        typeof error.code === "string" && error.code.length > 0
          ? error.code
          : "capability-error",
      message:
        typeof error.message === "string" && error.message.length > 0
          ? error.message
          : "capability transport returned an error",
    },
  };
}

export function buildQuotaErrorEnvelope(error: QuotaExceededError) {
  return {
    status: "error" as const,
    error: {
      code: error.code,
      message: error.message,
      quota_kind: error.quotaKind,
      remaining: error.remaining,
      limit_value: error.limitValue,
    },
  };
}

export async function buildToolQuotaAuthorization(
  authorizer: QuotaAuthorizer | null,
  context: QuotaRuntimeContext | null,
  requestId: string,
  toolName: string,
): Promise<Record<string, unknown> | undefined> {
  if (!authorizer || !context) return undefined;
  const ticket = await authorizer.authorize("tool", context, requestId, {
    tool_name: toolName,
  });
  return {
    verdict: "allow",
    quota_kind: "tool",
    request_id: ticket.requestId,
    tool_name: toolName,
    remaining: ticket.remaining,
    limit_value: ticket.limitValue,
  };
}

export interface MainlineKernelOptions {
  readonly ai: AiBindingLike;
  readonly quotaAuthorizer: QuotaAuthorizer | null;
  readonly capabilityTransport?: CapabilityTransportLike;
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
}

export const NANO_AGENT_SYSTEM_PROMPT =
  "You are nano-agent running inside Cloudflare Workers, not a Linux VM. " +
  "Use the provided tools as a governed fake-bash capability layer; do not assume POSIX shell, local OS access, or unsupported commands. " +
  "Prefer structured tool calls for filesystem, search, network, TypeScript execution, and git tasks, and surface unsupported capability needs explicitly.";

function withNanoAgentSystemPrompt(messages: readonly unknown[]): readonly unknown[] {
  const hasSystemPrompt = messages.some(
    (message) =>
      isRecord(message) &&
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.length > 0,
  );
  if (hasSystemPrompt) return messages;
  return [{ role: "system", content: NANO_AGENT_SYSTEM_PROMPT }, ...messages];
}

export function createMainlineKernelRunner(
  options: MainlineKernelOptions,
): KernelRunner {
  const llmRequestIds = new Map<string, string>();
  const gateway = new WorkersAiGateway(options.ai);
  let llmRequestSequence = 0;
  const runner = new KernelRunner(
    {
      llm: {
        async *call(request: unknown) {
          const messages = Array.isArray(request) ? request : [];
          const exec = buildWorkersAiExecutionRequestFromMessages({
            messages: withNanoAgentSystemPrompt(messages),
            tools: true,
          });
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
      capability: {
        async *execute(plan: unknown) {
          const request = isRecord(plan) ? plan : {};
          const requestId =
            typeof request.requestId === "string" && request.requestId.length > 0
              ? request.requestId
              : crypto.randomUUID();
          const toolName =
            typeof request.toolName === "string" && request.toolName.length > 0
              ? request.toolName
              : "unknown";
          const toolInput =
            request.args && typeof request.args === "object"
              ? request.args
              : {};

          if (!options.capabilityTransport) {
            yield {
              type: "result" as const,
              status: "error" as const,
              result: {
                code: "capability-transport-unavailable",
                message: "capability transport unavailable",
              },
            };
            return;
          }

          const quotaContext = options.contextProvider();
          try {
            const quota = await buildToolQuotaAuthorization(
              options.quotaAuthorizer,
              quotaContext,
              requestId,
              toolName,
            );
            const response = await options.capabilityTransport.call({
              requestId,
              capabilityName: toolName,
              body: {
                tool_name: toolName,
                tool_input: toolInput,
              },
              anchor: options.anchorProvider(),
              quota,
            });
            const parsed = parseCapabilityEnvelope(response);
            if (parsed.status === "ok") {
              if (options.quotaAuthorizer && quotaContext) {
                const balance = await options.quotaAuthorizer.commit("tool", quotaContext, requestId, {
                  tool_name: toolName,
                  status: "ok",
                });
                // ZX5 F3 — emit `session.usage.update` server frame after commit
                options.onUsageCommit?.({
                  kind: "tool",
                  remaining: balance.remaining,
                  limitValue: balance.limitValue,
                  detail: { tool_name: toolName, request_id: requestId },
                });
              }
              yield {
                type: "result" as const,
                status: "ok" as const,
                result: parsed.output,
              };
              return;
            }
            yield {
              type: "result" as const,
              status: "error" as const,
              result: parsed.error,
            };
          } catch (error) {
            if (error instanceof QuotaExceededError) {
              yield {
                type: "result" as const,
                status: "error" as const,
                result: {
                  code: error.code,
                  message: error.message,
                },
              };
              return;
            }
            yield {
              type: "result" as const,
              status: "error" as const,
              result: {
                code: "capability-execution-error",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        },
        cancel(requestId: string) {
          options.capabilityTransport?.cancel?.({
            requestId,
            body: { reason: "cancelled-by-host" },
            anchor: options.anchorProvider(),
          });
        },
      },
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
        async requestCompact() {
          return { tokensFreed: 0 };
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
          input_tokens: usage?.inputTokens ?? 0,
          output_tokens: usage?.outputTokens ?? 0,
        });
        // ZX5 F3 — emit `session.usage.update` server frame after commit
        options.onUsageCommit?.({
          kind: "llm",
          remaining: balance.remaining,
          limitValue: balance.limitValue,
          detail: {
            provider_key: "workers-ai",
            input_tokens: usage?.inputTokens ?? 0,
            output_tokens: usage?.outputTokens ?? 0,
            turn_id: turnId,
          },
        });
      },
    },
  );

  return runner;
}
