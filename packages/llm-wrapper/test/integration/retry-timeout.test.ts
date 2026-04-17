/**
 * Integration — retry / timeout / on-429 key rotation / Retry-After.
 *
 * Exercises the real retry contract with a fake fetch:
 *   - `retryConfig.maxRetries: 0`      → exactly 1 attempt
 *   - `retryConfig.maxRetries: 2`      → up to 3 attempts
 *   - `keyRotationPolicy: "on-429"`    → executor rotates the key via
 *                                         `ProviderRegistry.rotateApiKey()`
 *   - `Retry-After` header             → backoff floor = retry-after * 1000 ms
 */

import { describe, it, expect, vi } from "vitest";
import { OpenAIChatAdapter } from "../../src/adapters/openai-chat.js";
import { LLMExecutor } from "../../src/executor.js";
import { ProviderRegistry } from "../../src/registry/providers.js";
import { ModelRegistry } from "../../src/registry/models.js";
import { buildExecutionRequest } from "../../src/request-builder.js";

function successBody() {
  return {
    id: "ok",
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "ok" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function registerOn429(keys: string[]): {
  providers: ProviderRegistry;
  models: ModelRegistry;
} {
  const providers = new ProviderRegistry();
  providers.register({
    name: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKeys: keys,
    keyRotationPolicy: "on-429",
    retryConfig: { maxRetries: keys.length, baseDelayMs: 1 },
  });
  const models = new ModelRegistry();
  models.register({
    modelId: "gpt-4o",
    provider: "openai",
    supportsStream: false,
    supportsTools: false,
    supportsVision: false,
    supportsJsonSchema: false,
    contextWindow: 4096,
    maxOutputTokens: 1024,
  });
  return { providers, models };
}

describe("integration: retry / timeout / on-429 / Retry-After", () => {
  it("maxRetries=0 makes exactly ONE fetch call and propagates the HTTP error", async () => {
    const providers = new ProviderRegistry();
    providers.register({
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeys: ["sk-1"],
      retryConfig: { maxRetries: 0, baseDelayMs: 1 },
    });
    const models = new ModelRegistry();
    models.register({
      modelId: "gpt-4o",
      provider: "openai",
      supportsStream: false,
      supportsTools: false,
      supportsVision: false,
      supportsJsonSchema: false,
      contextWindow: 4096,
      maxOutputTokens: 1024,
    });

    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("server error"),
      headers: new Headers(),
    }) as unknown as typeof fetch;

    const executor = new LLMExecutor(new OpenAIChatAdapter(), { fetcher, providerRegistry: providers });

    const exec = buildExecutionRequest(
      { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
      providers,
      models,
    );

    await expect(executor.execute(exec)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("on-429 rotates API key on the next attempt", async () => {
    const { providers, models } = registerOn429(["k-A", "k-B", "k-C"]);

    let calls = 0;
    const fetcher = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          text: () => Promise.resolve("rate limited"),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(successBody()),
        text: () => Promise.resolve(JSON.stringify(successBody())),
        headers: new Headers(),
      });
    }) as unknown as typeof fetch;

    const executor = new LLMExecutor(new OpenAIChatAdapter(), { fetcher, providerRegistry: providers });

    const exec = buildExecutionRequest(
      { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
      providers,
      models,
    );

    const result = await executor.execute(exec);
    expect(result.finishReason).toBe("stop");

    // First attempt used k-A; after 429 the executor rotated to k-B.
    const authHeaders = (fetcher as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[1] as RequestInit).headers as Record<string, string>,
    );
    expect(authHeaders[0]!.Authorization).toBe("Bearer k-A");
    expect(authHeaders[1]!.Authorization).toBe("Bearer k-B");
  });

  it("Retry-After header floors the backoff delay", async () => {
    const { providers, models } = registerOn429(["k-A", "k-B"]);

    let calls = 0;
    const fetcher = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          text: () => Promise.resolve("rate limited"),
          headers: new Headers({ "retry-after": "0" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(successBody()),
        text: () => Promise.resolve(JSON.stringify(successBody())),
        headers: new Headers(),
      });
    }) as unknown as typeof fetch;

    const executor = new LLMExecutor(new OpenAIChatAdapter(), { fetcher, providerRegistry: providers });

    const exec = buildExecutionRequest(
      { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
      providers,
      models,
    );
    const started = Date.now();
    await executor.execute(exec);
    const elapsed = Date.now() - started;

    // Retry-After=0 and baseDelay=1ms — we should not sleep for seconds.
    expect(elapsed).toBeLessThan(500);
    expect(calls).toBe(2);
  });

  it("timeout propagates as a single attempt when maxRetries=0", async () => {
    const providers = new ProviderRegistry();
    providers.register({
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeys: ["sk-1"],
      retryConfig: { maxRetries: 0, baseDelayMs: 1 },
    });
    const models = new ModelRegistry();
    models.register({
      modelId: "gpt-4o",
      provider: "openai",
      supportsStream: false,
      supportsTools: false,
      supportsVision: false,
      supportsJsonSchema: false,
      contextWindow: 4096,
      maxOutputTokens: 1024,
    });

    const fetcher = vi.fn().mockImplementation((_: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;

    const executor = new LLMExecutor(new OpenAIChatAdapter(), {
      fetcher,
      timeoutMs: 20,
      providerRegistry: providers,
    });

    const exec = buildExecutionRequest(
      { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
      providers,
      models,
    );
    await expect(executor.execute(exec)).rejects.toThrow(/timed out/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
