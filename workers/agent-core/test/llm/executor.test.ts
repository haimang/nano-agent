import { describe, it, expect, vi } from "vitest";
import { LLMExecutor } from "../../src/llm/executor.js";
import { OpenAIChatAdapter } from "../../src/llm/adapters/openai-chat.js";
import { LlmWrapperError } from "../../src/llm/errors.js";
import type { ExecutionRequest } from "../../src/llm/request-builder.js";

// ── Fixtures ────────────────────────────────────────────────────

function makeExec(overrides?: Partial<ExecutionRequest>): ExecutionRequest {
  return {
    provider: {
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeys: ["sk-test"],
      retryConfig: { maxRetries: 2, baseDelayMs: 10 },
    },
    model: {
      modelId: "gpt-4o",
      provider: "openai",
      supportsStream: true,
      supportsTools: true,
      supportsVision: true,
      supportsJsonSchema: true,
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
    },
    request: {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    },
    apiKey: "sk-test",
    ...overrides,
  };
}

const successBody = {
  id: "chatcmpl-123",
  model: "gpt-4o",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hi there!" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
};

function mockFetch(
  body: unknown,
  status = 200,
): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  }) as unknown as typeof fetch;
}

function mockStreamFetch(chunks: string[]): typeof fetch {
  let chunkIndex = 0;
  const encoder = new TextEncoder();

  const mockReader = {
    read: vi.fn().mockImplementation(() => {
      if (chunkIndex < chunks.length) {
        const chunk = chunks[chunkIndex]!;
        chunkIndex++;
        return Promise.resolve({
          done: false,
          value: encoder.encode(chunk),
        });
      }
      return Promise.resolve({ done: true, value: undefined });
    }),
    releaseLock: vi.fn(),
  };

  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    body: { getReader: () => mockReader },
    headers: new Headers(),
  }) as unknown as typeof fetch;
}

// ── Tests ───────────────────────────────────────────────────────

describe("LLMExecutor", () => {
  describe("execute (non-streaming)", () => {
    it("returns parsed response on success", async () => {
      const fetcher = mockFetch(successBody);
      const executor = new LLMExecutor(new OpenAIChatAdapter(), {
        fetcher,
        maxRetries: 0,
      });

      const result = await executor.execute(makeExec());

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({ kind: "text", text: "Hi there!" });
      expect(result.finishReason).toBe("stop");
      expect(result.usage.inputTokens).toBe(5);
      expect(result.usage.outputTokens).toBe(3);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("sends correct URL and headers", async () => {
      const fetcher = mockFetch(successBody);
      const executor = new LLMExecutor(new OpenAIChatAdapter(), {
        fetcher,
        maxRetries: 0,
      });

      await executor.execute(makeExec());

      expect(fetcher).toHaveBeenCalledTimes(1);
      const [url, init] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(init.method).toBe("POST");
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer sk-test");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("retries on 500 error", async () => {
      let callCount = 0;
      const fetcher = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: () => Promise.resolve("Internal Server Error"),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(successBody),
          text: () => Promise.resolve(JSON.stringify(successBody)),
        });
      }) as unknown as typeof fetch;

      const executor = new LLMExecutor(new OpenAIChatAdapter(), {
        fetcher,
        maxRetries: 2,
      });

      const result = await executor.execute(makeExec());
      expect(result.finishReason).toBe("stop");
      expect(callCount).toBe(3);
    });

    it("retries on 429 rate limit", async () => {
      let callCount = 0;
      const fetcher = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            text: () => Promise.resolve("Rate limited"),
            headers: new Headers(),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(successBody),
          headers: new Headers(),
        });
      }) as unknown as typeof fetch;

      const executor = new LLMExecutor(new OpenAIChatAdapter(), {
        fetcher,
        maxRetries: 1,
      });

      const result = await executor.execute(makeExec());
      expect(result.finishReason).toBe("stop");
      expect(callCount).toBe(2);
    });

    it("provider.retryConfig.maxRetries=0 overrides constructor option and caps to one attempt", async () => {
      const fetcher = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("boom"),
        headers: new Headers(),
      }) as unknown as typeof fetch;

      const executor = new LLMExecutor(new OpenAIChatAdapter(), {
        fetcher,
        maxRetries: 3, // constructor says 3 …
      });

      // … but provider profile says 0.
      const exec = makeExec({
        provider: {
          name: "openai",
          baseUrl: "https://api.openai.com/v1",
          apiKeys: ["sk-test"],
          retryConfig: { maxRetries: 0, baseDelayMs: 1 },
        },
      });

      await expect(executor.execute(exec)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("honours Retry-After header with a 0-second value for a near-instant retry", async () => {
      let calls = 0;
      const fetcher = vi.fn().mockImplementation(() => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            text: () => Promise.resolve("rate limit"),
            headers: new Headers({ "retry-after": "0" }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(successBody),
          headers: new Headers(),
        });
      }) as unknown as typeof fetch;

      const executor = new LLMExecutor(new OpenAIChatAdapter(), {
        fetcher,
        maxRetries: 1,
      });

      const started = Date.now();
      await executor.execute(
        makeExec({
          provider: {
            name: "openai",
            baseUrl: "https://api.openai.com/v1",
            apiKeys: ["sk-test"],
            retryConfig: { maxRetries: 1, baseDelayMs: 1 },
          },
        }),
      );
      expect(Date.now() - started).toBeLessThan(500);
      expect(calls).toBe(2);
    });

    it("does not retry on 401 auth error", async () => {
      const fetcher = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      }) as unknown as typeof fetch;

      const executor = new LLMExecutor(new OpenAIChatAdapter(), {
        fetcher,
        maxRetries: 2,
      });

      await expect(executor.execute(makeExec())).rejects.toThrow(LlmWrapperError);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("does not retry on 400 bad request", async () => {
      const fetcher = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad request"),
      }) as unknown as typeof fetch;

      const executor = new LLMExecutor(new OpenAIChatAdapter(), {
        fetcher,
        maxRetries: 2,
      });

      await expect(executor.execute(makeExec())).rejects.toThrow(LlmWrapperError);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("throws on timeout", async () => {
      const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              const err = new DOMException("The operation was aborted.", "AbortError");
              reject(err);
            });
          }
        });
      }) as unknown as typeof fetch;

      const executor = new LLMExecutor(new OpenAIChatAdapter(), {
        fetcher,
        timeoutMs: 50,
        maxRetries: 0,
      });

      await expect(executor.execute(makeExec())).rejects.toThrow("timed out");
    });
  });

  describe("executeStream", () => {
    it("yields delta events from SSE chunks", async () => {
      const sseChunks = [
        'data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"content":" world"}}]}\n\n',
        'data: {"choices":[{"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
        "data: [DONE]\n\n",
      ];

      const fetcher = mockStreamFetch(sseChunks);
      const executor = new LLMExecutor(new OpenAIChatAdapter(), {
        fetcher,
        maxRetries: 0,
      });

      const events: import("../src/canonical.js").NormalizedLLMEvent[] = [];
      for await (const event of executor.executeStream(makeExec())) {
        events.push(event);
      }

      // First event is the llm.request.started lifecycle anchor, followed
      // by the two deltas and the finish event.
      expect(events).toHaveLength(4);
      expect(events[0]).toMatchObject({ type: "llm.request.started", modelId: "gpt-4o" });
      expect(events[1]).toEqual({ type: "delta", content: "Hello", index: 0 });
      expect(events[2]).toEqual({ type: "delta", content: " world", index: 0 });
      expect(events[3]!.type).toBe("finish");
    });

    it("throws on non-ok HTTP response during stream (after lifecycle event)", async () => {
      const fetcher = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Server Error"),
        headers: new Headers(),
      }) as unknown as typeof fetch;

      const executor = new LLMExecutor(new OpenAIChatAdapter(), {
        fetcher,
        maxRetries: 0,
      });

      const gen = executor.executeStream(makeExec());
      // The lifecycle anchor yields first …
      const first = await gen.next();
      expect(first.value).toMatchObject({ type: "llm.request.started" });
      // … and only the next iteration observes the HTTP error.
      await expect(gen.next()).rejects.toThrow(LlmWrapperError);
    });

    it("throws when response body is missing (after lifecycle event)", async () => {
      const fetcher = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
        headers: new Headers(),
      }) as unknown as typeof fetch;

      const executor = new LLMExecutor(new OpenAIChatAdapter(), {
        fetcher,
        maxRetries: 0,
      });

      const gen = executor.executeStream(makeExec());
      const first = await gen.next();
      expect(first.value).toMatchObject({ type: "llm.request.started" });
      await expect(gen.next()).rejects.toThrow("No response body");
    });
  });
});
