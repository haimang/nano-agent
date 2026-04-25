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
      supportsJsonSchema: false,
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
      notes: "Z3 first-wave primary model",
    },
    {
      modelId: WORKERS_AI_FALLBACK_MODEL,
      provider: WORKERS_AI_PROVIDER_KEY,
      supportsStream: true,
      supportsTools: true,
      supportsVision: false,
      supportsJsonSchema: false,
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
      notes: "Z3 first-wave fallback model",
    },
  ],
});

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
}): ExecutionRequest {
  const messages = input.messages
    .map((message) => toCanonicalMessage(message))
    .filter((message): message is CanonicalMessage => message !== null);
  return buildExecutionRequest(
    {
      model: input.modelId ?? WORKERS_AI_PRIMARY_MODEL,
      messages,
      stream: true,
      temperature: input.temperature,
      tools: input.tools ? buildWorkersAiTools() : undefined,
    },
    WORKERS_AI_REGISTRY.providers,
    WORKERS_AI_REGISTRY.models,
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
        messages: exec.request.messages,
        tools: Array.isArray(exec.request.tools) && exec.request.tools.length > 0,
        temperature: exec.request.temperature,
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
