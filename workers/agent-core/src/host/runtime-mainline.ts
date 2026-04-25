import type { CrossSeamAnchor } from "./cross-seam.js";
import { KernelRunner } from "../kernel/runner.js";
import type { AiBindingLike } from "../llm/adapters/workers-ai.js";
import {
  WorkersAiGateway,
  buildWorkersAiExecutionRequestFromMessages,
} from "../llm/gateway.js";
import { QuotaAuthorizer, QuotaExceededError, type QuotaRuntimeContext } from "./quota/authorizer.js";

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
            messages,
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
                await options.quotaAuthorizer.commit("tool", quotaContext, requestId, {
                  tool_name: toolName,
                  status: "ok",
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
        async emit(_event: string, _payload: unknown) {
          return undefined;
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
        await options.quotaAuthorizer.commit("llm", context, requestId, {
          provider_key: "workers-ai",
          input_tokens: usage?.inputTokens ?? 0,
          output_tokens: usage?.outputTokens ?? 0,
        });
      },
    },
  );

  return runner;
}
