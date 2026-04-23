/**
 * OpenAI Chat Completions Adapter
 *
 * Maps between CanonicalLLMRequest / ExecutionRequest and the OpenAI
 * Chat Completions API format. Also handles SSE stream chunk parsing.
 * Compatible with any OpenAI-API-compatible provider (OpenAI, Azure, etc.).
 */

import type { ChatCompletionAdapter } from "./types.js";
import type { ExecutionRequest } from "../request-builder.js";
import type {
  NormalizedLLMEvent,
  CanonicalLLMResult,
  CanonicalContentPart,
  CanonicalMessage,
} from "../canonical.js";
import type { FinishReason, LLMUsage } from "../usage.js";
import { createEmptyUsage } from "../usage.js";

// ── Internal OpenAI-format types ────────────────────────────────
//
// Translation-zone exception (P0 identifier-law §F3): `tool_call_id` and the
// bare `id` on OpenAIToolCall below are provider-raw field names; they only
// exist on these adapter-local interfaces and MUST NOT leak into canonical
// domain types. Anything that crosses back into nano-agent canonical code
// is named under the `*_uuid` / `*_key` law.

interface OpenAIMessage {
  role: string;
  content: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIContentPart {
  type: string;
  text?: string;
  image_url?: { url: string; detail?: string };
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIChoice {
  index: number;
  message?: {
    role?: string;
    content?: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  delta?: {
    role?: string;
    content?: string | null;
    tool_calls?: Array<{
      index: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string | null;
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface OpenAIResponse {
  id?: string;
  model?: string;
  choices?: OpenAIChoice[];
  usage?: OpenAIUsage;
}

// ── Adapter ─────────────────────────────────────────────────────

export class OpenAIChatAdapter implements ChatCompletionAdapter {
  buildRequestBody(exec: ExecutionRequest): unknown {
    const req = exec.request;
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map((m) => this.mapMessage(m)),
    };

    if (req.stream !== undefined) body["stream"] = req.stream;
    if (req.temperature !== undefined) body["temperature"] = req.temperature;
    if (req.maxTokens !== undefined) body["max_tokens"] = req.maxTokens;
    if (req.stopSequences !== undefined) body["stop"] = req.stopSequences;

    if (req.tools && req.tools.length > 0) {
      body["tools"] = req.tools;
    }

    if (req.jsonSchema !== undefined) {
      body["response_format"] = {
        type: "json_schema",
        json_schema: req.jsonSchema,
      };
    }

    if (req.stream) {
      body["stream_options"] = { include_usage: true };
    }

    return body;
  }

  buildRequestHeaders(exec: ExecutionRequest): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${exec.apiKey}`,
      ...exec.provider.defaultHeaders,
    };
    return headers;
  }

  parseStreamChunk(chunk: string): NormalizedLLMEvent | null {
    const trimmed = chunk.trim();

    // SSE format: "data: {...}" or "data: [DONE]"
    if (!trimmed.startsWith("data: ")) return null;
    const payload = trimmed.slice(6);

    if (payload === "[DONE]") return null;

    let parsed: OpenAIResponse;
    try {
      parsed = JSON.parse(payload) as OpenAIResponse;
    } catch {
      return null;
    }

    const choice = parsed.choices?.[0];
    if (!choice) {
      // Usage-only chunk at end of stream
      if (parsed.usage) {
        return {
          type: "finish",
          finishReason: "stop",
          usage: this.mapUsage(parsed.usage),
        };
      }
      return null;
    }

    // Check for finish
    if (choice.finish_reason) {
      return {
        type: "finish",
        finishReason: this.mapFinishReason(choice.finish_reason),
        usage: parsed.usage ? this.mapUsage(parsed.usage) : createEmptyUsage(),
      };
    }

    const delta = choice.delta;
    if (!delta) return null;

    // Tool call delta. OpenAI SSE may batch multiple tool-call pieces
    // in a single chunk — prefer a frame carrying a full id+name first
    // (the "kick-off" for a new tool call), otherwise fall back to an
    // argument-fragment delta. Each parseStreamChunk call returns a
    // single NormalizedLLMEvent, so if multiple kick-offs arrive in the
    // same chunk the caller must reassemble from subsequent chunks.
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      const kickoff = delta.tool_calls.find((t) => t.id && t.function?.name);
      if (kickoff) {
        return {
          type: "tool_call",
          id: kickoff.id!,
          name: kickoff.function!.name!,
          arguments: kickoff.function?.arguments ?? "",
        };
      }
      const fragment = delta.tool_calls.find((t) => t.function?.arguments);
      if (fragment) {
        return {
          type: "delta",
          content: fragment.function!.arguments!,
          index: fragment.index,
        };
      }
    }

    // Content delta
    if (delta.content) {
      return {
        type: "delta",
        content: delta.content,
        index: choice.index,
      };
    }

    return null;
  }

  parseNonStreamResponse(body: unknown): CanonicalLLMResult {
    const resp = body as OpenAIResponse;
    const choice = resp.choices?.[0];

    const content: CanonicalContentPart[] = [];

    if (choice?.message?.content) {
      content.push({ kind: "text", text: choice.message.content });
    }

    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          kind: "tool_call",
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
    }

    return {
      finishReason: this.mapFinishReason(choice?.finish_reason ?? "stop"),
      usage: resp.usage ? this.mapUsage(resp.usage) : createEmptyUsage(),
      content,
      model: resp.model ?? "",
      durationMs: 0, // Caller will set actual duration
    };
  }

  // ── Private helpers ─────────────────────────────────────────

  private mapMessage(msg: CanonicalMessage): OpenAIMessage {
    if (typeof msg.content === "string") {
      const mapped: OpenAIMessage = { role: this.mapRole(msg), content: msg.content };
      if (msg.name) mapped.name = msg.name;
      // For tool role, map to tool_call_id
      if (msg.role === "tool" && msg.name) {
        mapped.tool_call_id = msg.name;
      }
      return mapped;
    }

    // Multi-part content
    const toolCalls: OpenAIToolCall[] = [];
    const contentParts: OpenAIContentPart[] = [];
    let toolResultContent: string | undefined;
    let toolCallId: string | undefined;

    for (const part of msg.content) {
      switch (part.kind) {
        case "text":
          contentParts.push({ type: "text", text: part.text });
          break;
        case "image_url":
          contentParts.push({
            type: "image_url",
            image_url: { url: part.url },
          });
          break;
        case "tool_call":
          toolCalls.push({
            id: part.id,
            type: "function",
            function: { name: part.name, arguments: part.arguments },
          });
          break;
        case "tool_result":
          toolResultContent = part.content;
          toolCallId = part.toolCallId;
          break;
      }
    }

    // Tool result message
    if (toolResultContent !== undefined) {
      return {
        role: "tool",
        content: toolResultContent,
        tool_call_id: toolCallId,
      };
    }

    const result: OpenAIMessage = {
      role: this.mapRole(msg),
      content: contentParts.length > 0 ? contentParts : null,
    };
    if (toolCalls.length > 0) result.tool_calls = toolCalls;
    if (msg.name) result.name = msg.name;

    return result;
  }

  private mapRole(msg: CanonicalMessage): string {
    return msg.role;
  }

  private mapFinishReason(reason: string): FinishReason {
    switch (reason) {
      case "stop":
        return "stop";
      case "tool_calls":
        return "tool_calls";
      case "length":
        return "length";
      case "content_filter":
        return "content_filter";
      default:
        return "unknown";
    }
  }

  private mapUsage(usage: OpenAIUsage): LLMUsage {
    const input = usage.prompt_tokens ?? 0;
    const output = usage.completion_tokens ?? 0;
    return {
      inputTokens: input,
      outputTokens: output,
      totalTokens: usage.total_tokens ?? input + output,
    };
  }
}
