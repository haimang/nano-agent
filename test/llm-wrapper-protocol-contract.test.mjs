import test from "node:test";
import assert from "node:assert/strict";

import {
  mapLlmEventToSessionBody,
  ProviderRegistry,
  ModelRegistry,
  buildExecutionRequest,
  OpenAIChatAdapter,
  LLMExecutor,
} from "../packages/llm-wrapper/dist/index.js";
import { SessionStreamEventBodySchema } from "../packages/nacp-session/dist/stream-event.js";

test("llm-wrapper session mapping emits nacp-session-valid bodies", () => {
  const deltaBody = mapLlmEventToSessionBody({
    type: "delta",
    content: "hello",
    index: 0,
  });
  assert.notEqual(deltaBody, null);
  assert.equal(SessionStreamEventBodySchema.safeParse(deltaBody.body).success, true);

  const toolBody = mapLlmEventToSessionBody({
    type: "tool_call",
    id: "call-1",
    name: "search",
    arguments: '{"q":"nano"}',
  });
  assert.notEqual(toolBody, null);
  assert.equal(SessionStreamEventBodySchema.safeParse(toolBody.body).success, true);

  const errorBody = mapLlmEventToSessionBody({
    type: "error",
    error: {
      category: "rate_limit",
      message: "Too many requests",
      retryable: true,
    },
  });
  assert.notEqual(errorBody, null);
  assert.equal(SessionStreamEventBodySchema.safeParse(errorBody.body).success, true);
});

test("llm-wrapper executor rotates API keys on 429 and reuses nacp-safe session mapping", async () => {
  const providers = new ProviderRegistry();
  providers.register({
    name: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKeys: ["k-A", "k-B"],
    keyRotationPolicy: "on-429",
    retryConfig: { maxRetries: 1, baseDelayMs: 1 },
  });

  const models = new ModelRegistry();
  models.register({
    modelId: "gpt-4o",
    provider: "openai",
    supportsStream: true,
    supportsTools: false,
    supportsVision: false,
    supportsJsonSchema: false,
    contextWindow: 4096,
    maxOutputTokens: 1024,
  });

  let calls = 0;
  const fetcher = async (_url, init) => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        text: async () => "rate limited",
        headers: new Headers(),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
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
      }),
      text: async () => '{"ok":true}',
      headers: new Headers(),
    };
  };

  const exec = buildExecutionRequest(
    {
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    },
    providers,
    models,
  );

  const executor = new LLMExecutor(new OpenAIChatAdapter(), {
    fetcher,
    providerRegistry: providers,
  });
  const result = await executor.execute(exec);

  assert.equal(result.finishReason, "stop");
  assert.equal(calls, 2);
  assert.equal(providers.currentApiKey("openai"), "k-B");
});
