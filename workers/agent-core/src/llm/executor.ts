/**
 * LLM Executor
 *
 * Central execution engine: sends HTTP requests to LLM providers,
 * handles timeouts, retries with exponential backoff, streams SSE
 * responses, and honours `Retry-After` + `on-429` API key rotation.
 *
 * Retry contract (locked by action-plan):
 *   - `maxRetries` source of truth: `provider.retryConfig.maxRetries`
 *     if defined, otherwise constructor `options.maxRetries`, otherwise
 *     a hard default of 2. `maxRetries === 0` means "no retries at all"
 *     — only a single attempt is performed.
 *   - `baseDelayMs` follows the same resolution chain (default 1000ms).
 *   - On a retriable failure the executor waits `max(Retry-After * 1000,
 *     baseDelay * 2^attempt)` before the next attempt so very busy
 *     upstreams are honoured.
 *   - On a 429 with `keyRotationPolicy === "on-429"` the executor calls
 *     `registry.rotateApiKey(provider.name)` and reissues the next
 *     attempt with the rotated key.
 */

import type { ChatCompletionAdapter } from "./adapters/types.js";
import type { ExecutionRequest } from "./request-builder.js";
import type { CanonicalLLMResult, NormalizedLLMEvent } from "./canonical.js";
import type { ProviderRegistry } from "./registry/providers.js";
import { LlmWrapperError } from "./errors.js";

export interface LLMExecutorOptions {
  timeoutMs?: number;
  maxRetries?: number;
  fetcher?: typeof fetch;
  /**
   * Provider registry, required to honour `on-429` key rotation. When
   * omitted, the executor falls back to the static `exec.apiKey` for
   * every attempt (retries will reuse the same key).
   */
  providerRegistry?: ProviderRegistry;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 1000;

export class LLMExecutor {
  private readonly adapter: ChatCompletionAdapter;
  private readonly timeoutMs: number;
  private readonly optionMaxRetries: number;
  private readonly fetcher: typeof fetch;
  private readonly providerRegistry: ProviderRegistry | undefined;

  constructor(adapter: ChatCompletionAdapter, options?: LLMExecutorOptions) {
    this.adapter = adapter;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.optionMaxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetcher = options?.fetcher ?? globalThis.fetch;
    this.providerRegistry = options?.providerRegistry;
  }

  /** Execute a non-streaming LLM request with retry. */
  async execute(exec: ExecutionRequest): Promise<CanonicalLLMResult> {
    const url = `${exec.provider.baseUrl}/chat/completions`;
    const body = this.adapter.buildRequestBody(exec);

    // Resolve retry policy with the correct precedence.
    const maxRetries = this.resolveMaxRetries(exec);
    const baseDelay = this.resolveBaseDelay(exec);
    const wantsOn429Rotation =
      exec.provider.keyRotationPolicy === "on-429" && this.providerRegistry !== undefined;

    // Key the executor actually sends with. Mutable across attempts so
    // an on-429 rotation can take effect on the next loop iteration.
    let currentKey = exec.apiKey;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const start = Date.now();
        const headers = this.buildHeadersForKey(exec, currentKey);
        const response = await this.fetchWithTimeout(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "");
          const err = this.classifyHttpError(response.status, errorBody, exec.provider.name);

          if (err.retryable && attempt < maxRetries) {
            // on-429 rotation: advance the provider cursor and load the
            // newly-selected key for the next attempt.
            if (response.status === 429 && wantsOn429Rotation) {
              currentKey = this.providerRegistry!.rotateApiKey(exec.provider.name);
            }
            const retryAfterMs = this.parseRetryAfter(response);
            const backoffMs = Math.max(retryAfterMs, baseDelay * Math.pow(2, attempt));
            lastError = new LlmWrapperError(err.message, "HTTP_ERROR", err.category);
            await this.delay(backoffMs);
            continue;
          }
          throw new LlmWrapperError(err.message, "HTTP_ERROR", err.category);
        }

        const json: unknown = await response.json();
        const result = this.adapter.parseNonStreamResponse(json);
        const durationMs = Date.now() - start;

        return { ...result, durationMs };
      } catch (error) {
        if (error instanceof LlmWrapperError) {
          // Non-retryable categories must not be retried
          const retryableCategories = new Set(["rate_limit", "server_error", "network", "timeout"]);
          if (!retryableCategories.has(error.category) || attempt >= maxRetries) {
            throw error;
          }
          lastError = error;
          await this.delay(baseDelay * Math.pow(2, attempt));
          continue;
        }
        // Network / timeout errors
        const wrapped = this.wrapError(error);
        if (wrapped.retryable && attempt < maxRetries) {
          lastError = new LlmWrapperError(wrapped.message, wrapped.code, wrapped.category);
          await this.delay(baseDelay * Math.pow(2, attempt));
          continue;
        }
        throw new LlmWrapperError(wrapped.message, wrapped.code, wrapped.category);
      }
    }

    throw lastError ?? new LlmWrapperError("Max retries exceeded", "RETRY_EXHAUSTED", "unknown");
  }

  /** Execute a streaming LLM request, yielding normalized events. */
  async *executeStream(exec: ExecutionRequest): AsyncGenerator<NormalizedLLMEvent> {
    const url = `${exec.provider.baseUrl}/chat/completions`;
    const body = this.adapter.buildRequestBody({
      ...exec,
      request: { ...exec.request, stream: true },
    });
    const headers = this.buildHeadersForKey(exec, exec.apiKey);

    // Emit llm.request.started at the start of the stream so downstream
    // observability can anchor TTFT measurement against a real event.
    const requestId = this.readRequestId(exec);
    yield { type: "llm.request.started", requestId, modelId: exec.request.model };

    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      const err = this.classifyHttpError(response.status, errorBody, exec.provider.name);
      // Surface Retry-After in the error metadata (observability hook).
      const retryAfterMs = this.parseRetryAfter(response);
      const suffix = retryAfterMs > 0 ? ` (retry_after_ms=${retryAfterMs})` : "";
      throw new LlmWrapperError(`${err.message}${suffix}`, "HTTP_ERROR", err.category);
    }

    if (!response.body) {
      throw new LlmWrapperError("No response body for stream", "NO_BODY", "server_error");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep last potentially incomplete line in buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const event = this.adapter.parseStreamChunk(trimmed);
          if (event) yield event;
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const event = this.adapter.parseStreamChunk(buffer.trim());
        if (event) yield event;
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── Private helpers ─────────────────────────────────────────

  /**
   * Resolution: `exec.provider.retryConfig.maxRetries` wins if present;
   * otherwise the constructor option; otherwise a hard default.
   * `maxRetries === 0` is respected (no retries).
   */
  private resolveMaxRetries(exec: ExecutionRequest): number {
    const fromProvider = exec.provider.retryConfig?.maxRetries;
    if (typeof fromProvider === "number") return Math.max(0, fromProvider);
    return Math.max(0, this.optionMaxRetries);
  }

  private resolveBaseDelay(exec: ExecutionRequest): number {
    const fromProvider = exec.provider.retryConfig?.baseDelayMs;
    if (typeof fromProvider === "number") return Math.max(0, fromProvider);
    return DEFAULT_BASE_DELAY_MS;
  }

  /**
   * Rebuild the headers map for a given API key. Delegates to the
   * adapter's `buildRequestHeaders` to keep auth-header conventions
   * in one place.
   */
  private buildHeadersForKey(exec: ExecutionRequest, apiKey: string): Record<string, string> {
    return this.adapter.buildRequestHeaders({ ...exec, apiKey });
  }

  /**
   * Parse an HTTP `Retry-After` header into milliseconds.
   * Supports both the seconds form and the HTTP-date form.
   * Returns 0 when absent, malformed, or in the past.
   */
  private parseRetryAfter(response: Response): number {
    const raw = response.headers.get("retry-after");
    if (!raw) return 0;
    const secondsForm = Number(raw);
    if (Number.isFinite(secondsForm) && secondsForm >= 0) {
      return Math.floor(secondsForm * 1000);
    }
    const dateMs = Date.parse(raw);
    if (!Number.isNaN(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
    return 0;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetcher(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new LlmWrapperError(
          `Request timed out after ${this.timeoutMs}ms`,
          "TIMEOUT",
          "timeout",
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private classifyHttpError(
    status: number,
    body: string,
    provider: string,
  ): { message: string; category: import("./errors.js").LLMErrorCategory; retryable: boolean } {
    const msg = `HTTP ${status} from ${provider}: ${body.slice(0, 200)}`;
    switch (true) {
      case status === 401 || status === 403:
        return { message: msg, category: "auth", retryable: false };
      case status === 429:
        return { message: msg, category: "rate_limit", retryable: true };
      case status === 400:
        return { message: msg, category: "invalid_request", retryable: false };
      case status >= 500:
        return { message: msg, category: "server_error", retryable: true };
      default:
        return { message: msg, category: "unknown", retryable: false };
    }
  }

  private wrapError(error: unknown): {
    message: string;
    code: string;
    category: import("./errors.js").LLMErrorCategory;
    retryable: boolean;
  } {
    if (error instanceof LlmWrapperError) {
      return {
        message: error.message,
        code: error.code,
        category: error.category,
        retryable: error.category === "rate_limit" || error.category === "server_error",
      };
    }
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("timed out") || msg.includes("TIMEOUT")) {
      return { message: msg, code: "TIMEOUT", category: "timeout", retryable: true };
    }
    return { message: `Network error: ${msg}`, code: "NETWORK", category: "network", retryable: true };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Best-effort extraction of a caller-supplied requestId from
   * `CanonicalLLMRequest.metadata.requestId`. Falls back to an empty
   * string — which is deliberately preserved in the emitted event so
   * callers can see "no requestId was provided" rather than a generated
   * one that nothing else references.
   */
  private readRequestId(exec: ExecutionRequest): string {
    const meta = exec.request.metadata ?? {};
    const raw = (meta as Record<string, unknown>)["requestId"];
    return typeof raw === "string" ? raw : "";
  }
}
