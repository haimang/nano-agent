import {
  buildWorkersAiTools,
  invokeWorkersAi,
  type AiBindingLike,
  WORKERS_AI_FALLBACK_MODEL,
  WORKERS_AI_PRIMARY_MODEL,
} from "./adapters/workers-ai.js";
import type {
  CanonicalContentPart,
  CanonicalLLMResult,
  CanonicalMessage,
  NormalizedLLMEvent,
} from "./canonical.js";
import { createEmptyUsage } from "./usage.js";
import { buildExecutionRequest, type ExecutionRequest } from "./request-builder.js";
import { loadRegistryFromConfig } from "./registry/loader.js";
import type { ModelCapabilities } from "./registry/models.js";

export const WORKERS_AI_PROVIDER_KEY = "workers-ai";

const WORKERS_AI_REGISTRY = loadRegistryFromConfig({
  providers: [
    {
      name: WORKERS_AI_PROVIDER_KEY,
      baseUrl: "cloudflare://ai",
      apiKeys: ["workers-ai-binding"],
      notes: "Platform-native Cloudflare Workers AI binding",
    },
  ],
  models: [
    {
      modelId: WORKERS_AI_PRIMARY_MODEL,
      provider: WORKERS_AI_PROVIDER_KEY,
      supportsStream: true,
      supportsTools: true,
      supportsVision: false,
      supportsReasoning: false,
      supportsJsonSchema: false,
      contextWindow: 131_072,
      maxOutputTokens: 8_192,
      notes: "Z3 first-wave primary model",
    },
    {
      modelId: WORKERS_AI_FALLBACK_MODEL,
      provider: WORKERS_AI_PROVIDER_KEY,
      supportsStream: true,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: true,
      reasoningEfforts: ["low", "medium", "high"],
      supportsJsonSchema: false,
      contextWindow: 131_072,
      maxOutputTokens: 8_192,
      notes: "Z3 first-wave fallback model",
    },
  ],
});

function toBooleanFlag(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

export async function loadWorkersAiModelCapabilities(db: D1Database): Promise<ModelCapabilities[]> {
  const rows = await db.prepare(
    `SELECT model_id, context_window, is_reasoning, is_vision, is_function_calling
       FROM nano_models
      WHERE status = 'active'
      ORDER BY model_id ASC`,
  ).all<Record<string, unknown>>();
  return (rows.results ?? []).flatMap((row) => {
    const modelId = typeof row.model_id === "string" && row.model_id.length > 0 ? row.model_id : null;
    if (!modelId) return [];
    const supportsReasoning = toBooleanFlag(row.is_reasoning);
    return [{
      modelId,
      provider: WORKERS_AI_PROVIDER_KEY,
      supportsStream: true,
      supportsTools: toBooleanFlag(row.is_function_calling),
      supportsVision: toBooleanFlag(row.is_vision),
      supportsReasoning,
      reasoningEfforts: supportsReasoning ? ["low", "medium", "high"] : undefined,
      supportsJsonSchema: false,
      contextWindow: toPositiveInt(row.context_window, 8192),
      maxOutputTokens: 8_192,
    }];
  });
}

function createWorkersAiRegistry(
  extraModels: readonly ModelCapabilities[] | undefined,
): typeof WORKERS_AI_REGISTRY {
  if (!extraModels || extraModels.length === 0) return WORKERS_AI_REGISTRY;
  const registry = loadRegistryFromConfig({
    providers: WORKERS_AI_REGISTRY.providers.list(),
    models: [
      ...WORKERS_AI_REGISTRY.models.list(),
      ...extraModels,
    ],
  });
  return registry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toCanonicalContentPart(part: unknown): CanonicalContentPart {
  if (!isRecord(part)) {
    return { kind: "text", text: stringifyContent(part) };
  }
  switch (part.kind) {
    case "text":
      return {
        kind: "text",
        text: typeof part.text === "string" ? part.text : stringifyContent(part.text),
      };
    case "image_url":
      return {
        kind: "image_url",
        url: typeof part.url === "string" ? part.url : "",
        mimeType: typeof part.mimeType === "string" ? part.mimeType : undefined,
      };
    case "tool_call":
      return {
        kind: "tool_call",
        id: typeof part.id === "string" ? part.id : crypto.randomUUID(),
        name: typeof part.name === "string" ? part.name : "unknown",
        arguments:
          typeof part.arguments === "string"
            ? part.arguments
            : stringifyContent(part.arguments ?? part.input ?? {}),
      };
    case "tool_result":
      return {
        kind: "tool_result",
        toolCallId:
          typeof part.toolCallId === "string"
            ? part.toolCallId
            : typeof part.tool_call_id === "string"
              ? part.tool_call_id
              : "unknown",
        content: stringifyContent(part.content),
        isError: Boolean(part.isError),
      };
    default:
      return { kind: "text", text: stringifyContent(part) };
  }
}

function inferModelId(messages: readonly unknown[], fallback: string | undefined): string | undefined {
  if (fallback) return fallback;
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const value = message.model_id ?? message.modelId;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function inferReasoning(
  messages: readonly unknown[],
  fallback: { readonly effort: "low" | "medium" | "high" } | undefined,
): { readonly effort: "low" | "medium" | "high" } | undefined {
  if (fallback) return fallback;
  for (const message of messages) {
    if (!isRecord(message) || !isRecord(message.reasoning)) continue;
    const effort = message.reasoning.effort;
    if (effort === "low" || effort === "medium" || effort === "high") {
      return { effort };
    }
  }
  return undefined;
}

export function toCanonicalMessage(message: unknown): CanonicalMessage | null {
  if (typeof message === "string") {
    return { role: "user", content: message };
  }
  if (!isRecord(message)) return null;
  const role =
    message.role === "system" ||
    message.role === "assistant" ||
    message.role === "tool"
      ? message.role
      : "user";
  const content = Array.isArray(message.content)
    ? message.content.map((part) => toCanonicalContentPart(part))
    : stringifyContent(message.content);
  const name = typeof message.name === "string" ? message.name : undefined;
  return { role, content, ...(name ? { name } : {}) };
}

export function buildWorkersAiExecutionRequestFromMessages(input: {
  readonly messages: readonly unknown[];
  readonly temperature?: number;
  readonly tools?: boolean;
  readonly modelId?: string;
  readonly reasoning?: { readonly effort: "low" | "medium" | "high" };
  readonly modelCapabilities?: readonly ModelCapabilities[];
}): ExecutionRequest {
  const registry = createWorkersAiRegistry(input.modelCapabilities);
  const messages = input.messages
    .map((message) => toCanonicalMessage(message))
    .filter((message): message is CanonicalMessage => message !== null);
  return buildExecutionRequest(
    {
      model: inferModelId(input.messages, input.modelId) ?? WORKERS_AI_PRIMARY_MODEL,
      messages,
      reasoning: inferReasoning(input.messages, input.reasoning),
      stream: true,
      temperature: input.temperature,
      tools: input.tools ? buildWorkersAiTools() : undefined,
    },
    registry.providers,
    registry.models,
  );
}

export interface InferenceGateway {
  execute(exec: ExecutionRequest): Promise<CanonicalLLMResult>;
  executeStream(exec: ExecutionRequest): AsyncGenerator<NormalizedLLMEvent>;
}

export class WorkersAiGateway implements InferenceGateway {
  constructor(private readonly ai: AiBindingLike) {}

  async execute(exec: ExecutionRequest): Promise<CanonicalLLMResult> {
    const startedAt = Date.now();
    const content: CanonicalContentPart[] = [];
    let usage = createEmptyUsage();
    let finishReason: CanonicalLLMResult["finishReason"] = "unknown";

    for await (const event of this.executeStream(exec)) {
      switch (event.type) {
        case "delta":
          content.push({ kind: "text", text: event.content });
          break;
        case "tool_call":
          content.push({
            kind: "tool_call",
            id: event.id,
            name: event.name,
            arguments: event.arguments,
          });
          break;
        case "finish":
          usage = event.usage;
          finishReason = event.finishReason;
          break;
        case "error":
          throw new Error(event.error.message);
        default:
          break;
      }
    }

    return {
      finishReason,
      usage,
      content,
      model: exec.model.modelId,
      durationMs: Date.now() - startedAt,
    };
  }

  async *executeStream(exec: ExecutionRequest): AsyncGenerator<NormalizedLLMEvent> {
    const requestId = crypto.randomUUID();
    yield {
      type: "llm.request.started",
      requestId,
      modelId: exec.model.modelId,
    };

    let usage = createEmptyUsage();
    let sawToolCalls = false;
    try {
      for await (const chunk of invokeWorkersAi(this.ai, {
        modelId: exec.model.modelId,
        messages: exec.request.messages,
        tools: Array.isArray(exec.request.tools) && exec.request.tools.length > 0,
        temperature: exec.request.temperature,
        reasoning: exec.request.reasoning,
      })) {
        switch (chunk.type) {
          case "content":
            yield {
              type: "delta",
              content: chunk.content,
              index: 0,
            };
            break;
          case "tool_calls":
            sawToolCalls = sawToolCalls || chunk.calls.length > 0;
            for (const call of chunk.calls) {
              yield {
                type: "tool_call",
                id: call.id,
                name: call.name,
                arguments: stringifyContent(call.input ?? {}),
              };
            }
            break;
          case "usage":
            usage = {
              inputTokens: chunk.usage.inputTokens,
              outputTokens: chunk.usage.outputTokens,
              totalTokens: chunk.usage.inputTokens + chunk.usage.outputTokens,
            };
            break;
        }
      }
    } catch (error) {
      yield {
        type: "error",
        error: {
          category: "server_error",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
          requestId,
          provider: WORKERS_AI_PROVIDER_KEY,
        },
      };
      return;
    }

    yield {
      type: "finish",
      finishReason: sawToolCalls ? "tool_calls" : "stop",
      usage,
    };
  }
}
