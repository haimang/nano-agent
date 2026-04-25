import type { LlmChunk } from "../../kernel/types.js";
import { LLM_TOOL_DECLARATIONS } from "../tool-registry.js";

export interface AiBindingLike {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export const WORKERS_AI_PRIMARY_MODEL = "@cf/ibm-granite/granite-4.0-h-micro";
export const WORKERS_AI_FALLBACK_MODEL =
  "@cf/meta/llama-4-scout-17b-16e-instruct";

type WorkersAiMessage =
  | {
      readonly role: "system" | "user" | "assistant";
      readonly content: string;
    }
  | {
      readonly role: "tool";
      readonly content: string;
      readonly tool_call_id: string;
    };

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

export function normalizeWorkersAiMessages(
  messages: readonly unknown[],
): WorkersAiMessage[] {
  const out: WorkersAiMessage[] = [];
  for (const message of messages) {
    if (typeof message === "string") {
      out.push({ role: "user", content: message });
      continue;
    }
    if (!isRecord(message)) continue;
    const role =
      message.role === "system" ||
      message.role === "assistant" ||
      message.role === "tool"
        ? message.role
        : "user";
    const content = stringifyContent(message.content);
    if (role === "tool") {
      const toolCallId =
        typeof message.tool_call_id === "string" && message.tool_call_id.length > 0
          ? message.tool_call_id
          : typeof message.toolCallId === "string" && message.toolCallId.length > 0
            ? message.toolCallId
            : "000000001";
      out.push({
        role: "tool",
        content,
        tool_call_id: toolCallId,
      });
      continue;
    }
    out.push({
      role,
      content,
    });
  }
  return out;
}

export function buildWorkersAiTools() {
  return LLM_TOOL_DECLARATIONS.map((decl) => ({
      type: "function" as const,
      function: {
        name: decl.name,
        description: decl.description,
        parameters: decl.inputSchema,
      },
    }));
}

function normalizeToolCalls(raw: unknown): Array<{ id: string; name: string; input?: unknown }> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    if (isRecord(item.function)) {
      const name = item.function.name;
      const rawArgs = item.function.arguments;
      let parsedArgs: unknown = undefined;
      if (typeof rawArgs === "string" && rawArgs.length > 0) {
        try {
          parsedArgs = JSON.parse(rawArgs);
        } catch {
          parsedArgs = { raw: rawArgs };
        }
      }
      return typeof name === "string" && name.length > 0
        ? [{
            id:
              typeof item.id === "string" && item.id.length > 0
                ? item.id
                : crypto.randomUUID(),
            name,
            input: parsedArgs,
          }]
        : [];
    }
    const name = item.name;
    return typeof name === "string" && name.length > 0
      ? [{
          id:
            typeof item.id === "string" && item.id.length > 0
              ? item.id
              : crypto.randomUUID(),
          name,
          input: item.arguments,
        }]
      : [];
  });
}

function maybeUsage(raw: unknown):
  | { inputTokens: number; outputTokens: number }
  | undefined {
  if (!isRecord(raw)) return undefined;
  const prompt = raw.prompt_tokens ?? raw.input_tokens ?? raw.inputTokens;
  const completion =
    raw.completion_tokens ?? raw.output_tokens ?? raw.outputTokens;
  if (
    typeof prompt === "number" &&
    Number.isFinite(prompt) &&
    typeof completion === "number" &&
    Number.isFinite(completion)
  ) {
    return {
      inputTokens: Math.max(0, Math.trunc(prompt)),
      outputTokens: Math.max(0, Math.trunc(completion)),
    };
  }
  return undefined;
}

async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<LlmChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const chunk of parseSseEvent(rawEvent)) {
          yield chunk;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }

    if (buffer.trim().length > 0) {
      for (const chunk of parseSseEvent(buffer)) {
        yield chunk;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseEvent(rawEvent: string): LlmChunk[] {
  const lines = rawEvent
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const payloads = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line !== "[DONE]");

  const out: LlmChunk[] = [];
  for (const payload of payloads) {
    try {
      const parsed = JSON.parse(payload) as unknown;
      out.push(...normalizeWorkersAiResponse(parsed));
    } catch {
      continue;
    }
  }
  return out;
}

function normalizeWorkersAiResponse(raw: unknown): LlmChunk[] {
  if (!isRecord(raw)) return [];
  const out: LlmChunk[] = [];

  const toolCalls =
    normalizeToolCalls(raw.tool_calls) ||
    normalizeToolCalls(raw.toolCalls);
  if (toolCalls.length > 0) {
    out.push({ type: "tool_calls", calls: toolCalls });
  }

  const responseText =
    typeof raw.response === "string"
      ? raw.response
      : typeof raw.content === "string"
        ? raw.content
        : typeof raw.delta === "string"
          ? raw.delta
          : undefined;
  if (responseText && responseText.length > 0) {
    out.push({ type: "content", content: responseText });
  }

  const usage = maybeUsage(raw.usage ?? raw);
  if (usage) out.push({ type: "usage", usage });
  return out;
}

export async function* invokeWorkersAi(
  ai: AiBindingLike,
  input: {
    readonly messages: readonly unknown[];
    readonly tools?: boolean;
    readonly temperature?: number;
  },
): AsyncGenerator<LlmChunk> {
  const payload: Record<string, unknown> = {
    messages: normalizeWorkersAiMessages(input.messages),
    stream: true,
    temperature: input.temperature ?? 0.2,
  };
  if (input.tools) {
    payload.tools = buildWorkersAiTools();
  }

  let lastError: unknown;
  for (const model of [WORKERS_AI_PRIMARY_MODEL, WORKERS_AI_FALLBACK_MODEL]) {
    try {
      const response = await ai.run(model, payload);
      if (response instanceof ReadableStream) {
        for await (const chunk of parseSseStream(response)) {
          yield chunk;
        }
      } else {
        for (const chunk of normalizeWorkersAiResponse(response)) {
          yield chunk;
        }
      }
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Workers AI invocation failed");
}
