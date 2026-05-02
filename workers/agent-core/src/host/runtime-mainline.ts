import type { CrossSeamAnchor } from "./cross-seam.js";
import { KernelRunner } from "../kernel/runner.js";
import type { AiBindingLike } from "../llm/adapters/workers-ai.js";
import { SessionTodosWriteBodySchema } from "@haimang/nacp-session";
import {
  WorkersAiGateway,
  buildWorkersAiExecutionRequestFromMessages,
  loadWorkersAiModelCapabilities,
} from "../llm/gateway.js";
import { QuotaAuthorizer, QuotaExceededError, type QuotaRuntimeContext } from "./quota/authorizer.js";
import type { HookDispatcher, HookEmitContext } from "../hooks/dispatcher.js";
import type { HookEventName } from "../hooks/catalog.js";

// HPX5 F2b — local alias for the 5-status Q19 todo enum used by
// write_todos input. Mirrors `SessionTodoStatusSchema` in nacp-session.
type TodoStatusLiteral = "pending" | "in_progress" | "completed" | "cancelled" | "blocked";

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
  readonly kind: "tool_use_start" | "tool_use_delta" | "tool_call_result";
  readonly tool_call_id: string;
  readonly tool_name: string;
  readonly tool_input?: Record<string, unknown>;
  readonly args_chunk?: string;
  readonly status?: "ok" | "error";
  readonly output?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

async function authorizeToolPlan(
  options: MainlineKernelOptions,
  requestId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<{ allowed: true } | { allowed: false; error: { code: string; message: string; source?: string } }> {
  const ctx = options.contextProvider();
  if (!ctx || !options.authorizeToolUse) return { allowed: true };
  const result = await options.authorizeToolUse(
    {
      session_uuid: ctx.sessionUuid,
      team_uuid: ctx.teamUuid,
      tool_name: toolName,
      tool_input: toolInput,
    },
    { trace_uuid: ctx.traceUuid, team_uuid: ctx.teamUuid },
  );
  if (result.decision === "allow") return { allowed: true };
  const code = result.decision === "ask" ? "tool-permission-required" : "tool-permission-denied";
  return {
    allowed: false,
    error: {
      code,
      message: `tool ${toolName} was ${result.decision === "ask" ? "blocked pending permission" : "denied by runtime policy"}`,
      source: result.source,
    },
  };
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
          const normalizedToolInput = toolInput as Record<string, unknown>;
          const permission = await authorizeToolPlan(
            options,
            requestId,
            toolName,
            normalizedToolInput,
          );
          if (!permission.allowed) {
            options.onToolEvent?.({
              kind: "tool_call_result",
              tool_call_id: requestId,
              tool_name: toolName,
              status: "error",
              error: permission.error,
            });
            yield { type: "result" as const, status: "error" as const, result: permission.error };
            return;
          }

          // HPX5 F2b — WriteTodos capability short-circuit. LLM emits
          // `tool_use { name: "write_todos", ... }`; route to orchestrator-core
          // D1TodoControlPlane via writeTodosBackend (no regular transport).
          if (toolName === "write_todos") {
            options.onToolEvent?.({
              kind: "tool_use_start",
              tool_call_id: requestId,
              tool_name: toolName,
              tool_input: normalizedToolInput,
            });
            if (!options.writeTodosBackend) {
              const errorBody = {
                code: "capability-not-wired",
                message: "writeTodosBackend not configured on host",
              };
              options.onToolEvent?.({
                kind: "tool_call_result",
                tool_call_id: requestId,
                tool_name: toolName,
                status: "error",
                error: errorBody,
              });
              yield { type: "result" as const, status: "error" as const, result: errorBody };
              return;
            }
            const ctx = options.contextProvider();
            if (!ctx) {
              const errorBody = {
                code: "capability-not-wired",
                message: "session context unavailable for write_todos",
              };
              options.onToolEvent?.({
                kind: "tool_call_result",
                tool_call_id: requestId,
                tool_name: toolName,
                status: "error",
                error: errorBody,
              });
              yield { type: "result" as const, status: "error" as const, result: errorBody };
              return;
            }
            const argsObj = toolInput as {
              readonly todos?: unknown;
              readonly conversation_uuid?: unknown;
              readonly user_uuid?: unknown;
            };
            const parsedWrite = SessionTodosWriteBodySchema.safeParse(normalizedToolInput);
            if (!parsedWrite.success) {
              const errorBody = {
                code: "invalid-input",
                message: parsedWrite.error.message,
              };
              options.onToolEvent?.({
                kind: "tool_call_result",
                tool_call_id: requestId,
                tool_name: toolName,
                status: "error",
                error: errorBody,
              });
              yield { type: "result" as const, status: "error" as const, result: errorBody };
              return;
            }
            try {
              const result = await options.writeTodosBackend({
                session_uuid: ctx.sessionUuid,
                conversation_uuid: typeof argsObj.conversation_uuid === "string" ? argsObj.conversation_uuid : ctx.sessionUuid,
                team_uuid: ctx.teamUuid,
                user_uuid: typeof argsObj.user_uuid === "string" ? argsObj.user_uuid : ctx.teamUuid,
                trace_uuid: ctx.traceUuid,
                todos: parsedWrite.data.todos as Array<{
                  content: string;
                  status?: TodoStatusLiteral;
                  parent_todo_uuid?: string | null;
                }>,
              });
              if (result.ok) {
                options.onToolEvent?.({
                  kind: "tool_call_result",
                  tool_call_id: requestId,
                  tool_name: toolName,
                  status: "ok",
                  output: result,
                });
                yield { type: "result" as const, status: "ok" as const, result };
                return;
              }
              options.onToolEvent?.({
                kind: "tool_call_result",
                tool_call_id: requestId,
                tool_name: toolName,
                status: "error",
                error: result.error,
              });
              yield { type: "result" as const, status: "error" as const, result: result.error };
            } catch (err) {
              const errorBody = {
                code: "capability-execution-error",
                message: err instanceof Error ? err.message : String(err),
              };
              options.onToolEvent?.({
                kind: "tool_call_result",
                tool_call_id: requestId,
                tool_name: toolName,
                status: "error",
                error: errorBody,
              });
              yield { type: "result" as const, status: "error" as const, result: errorBody };
            }
            return;
          }

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

          // RH2 P2-12 — emit tool_use_start before exec.
          options.onToolEvent?.({
            kind: "tool_use_start",
            tool_call_id: requestId,
            tool_name: toolName,
              tool_input: normalizedToolInput,
          });

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
              // RH2 P2-12 — emit tool.call.result on success.
              options.onToolEvent?.({
                kind: "tool_call_result",
                tool_call_id: requestId,
                tool_name: toolName,
                status: "ok",
                output: parsed.output,
              });
              yield {
                type: "result" as const,
                status: "ok" as const,
                result: parsed.output,
              };
              return;
            }
            // RH2 P2-12 — emit tool.call.result on error.
            options.onToolEvent?.({
              kind: "tool_call_result",
              tool_call_id: requestId,
              tool_name: toolName,
              status: "error",
              error: parsed.error,
            });
            yield {
              type: "result" as const,
              status: "error" as const,
              result: parsed.error,
            };
          } catch (error) {
            if (error instanceof QuotaExceededError) {
              options.onToolEvent?.({
                kind: "tool_call_result",
                tool_call_id: requestId,
                tool_name: toolName,
                status: "error",
                error: { code: error.code, message: error.message },
              });
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
            const errorBody = {
              code: "capability-execution-error",
              message: error instanceof Error ? error.message : String(error),
            };
            options.onToolEvent?.({
              kind: "tool_call_result",
              tool_call_id: requestId,
              tool_name: toolName,
              status: "error",
              error: errorBody,
            });
            yield {
              type: "result" as const,
              status: "error" as const,
              result: errorBody,
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
