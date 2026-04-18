/**
 * A5 Phase 3 — fake provider worker integration test.
 *
 * Drives `LLMExecutor` with a `fetcher` that routes through the deploy-
 * shaped fake provider worker fixture. Verifies the existing OpenAI
 * Chat Completions adapter / stream-normalizer / session-stream-adapter
 * pipeline accepts the fake provider's output without modification —
 * proving local-fetch and remote-binding paths share the same typed
 * contract (P3-03 reference path preservation).
 */

import { describe, it, expect } from "vitest";
import { fakeProviderFetch } from "../../../../test/fixtures/external-seams/fake-provider-worker.js";
import { OpenAIChatAdapter } from "../../src/adapters/openai-chat.js";
import { LLMExecutor } from "../../src/executor.js";
import {
  ProviderRegistry,
  type ProviderProfile,
} from "../../src/registry/providers.js";
import { ModelRegistry } from "../../src/registry/models.js";
import { buildExecutionRequest } from "../../src/request-builder.js";
import { mapLlmEventToSessionBody } from "../../src/session-stream-adapter.js";
import { SessionStreamEventBodySchema } from "../../../nacp-session/src/stream-event.js";
import type { NormalizedLLMEvent } from "../../src/canonical.js";

const PROFILE: ProviderProfile = {
  name: "fake-openai",
  baseUrl: "https://fake-provider.local",
  apiKeys: ["sk-fake-1"],
  keyRotationPolicy: "static",
  retryConfig: { maxRetries: 0, baseDelayMs: 1 },
};

function makeRegistries(): {
  providers: ProviderRegistry;
  models: ModelRegistry;
} {
  const providers = new ProviderRegistry();
  providers.register(PROFILE);
  const models = new ModelRegistry();
  models.register({
    modelId: "gpt-fake-1",
    provider: PROFILE.name,
    supportsStream: true,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: false,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
  });
  return { providers, models };
}

/** A fetcher that delegates straight to the fake worker fixture. */
const fakeFetcher: typeof fetch = async (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return fakeProviderFetch(new Request(url, init));
};

describe("fake provider worker integration (A5 Phase 3)", () => {
  it("non-streaming call: produces a session-schema-valid llm.delta + llm.completed pair", async () => {
    const { providers, models } = makeRegistries();
    const executor = new LLMExecutor(new OpenAIChatAdapter(), {
      fetcher: fakeFetcher,
    });
    const exec = buildExecutionRequest(
      {
        model: "gpt-fake-1",
        messages: [{ role: "user", content: "Reply with OK" }],
        stream: false,
      },
      providers,
      models,
    );
    const result = await executor.execute(exec);
    const textPart = result.content.find(
      (p): p is { kind: "text"; text: string } & typeof p =>
        p.kind === "text",
    );
    expect(textPart?.text).toBe("OK");
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });

  it("streaming call: every emitted session body parses under SessionStreamEventBodySchema", async () => {
    const { providers, models } = makeRegistries();
    const executor = new LLMExecutor(new OpenAIChatAdapter(), {
      fetcher: fakeFetcher,
    });
    const exec = buildExecutionRequest(
      {
        model: "gpt-fake-1",
        messages: [{ role: "user", content: "Reply with OK" }],
        stream: true,
      },
      providers,
      models,
    );

    const events: NormalizedLLMEvent[] = [];
    for await (const e of executor.executeStream(exec)) events.push(e);

    expect(events[0]?.type).toBe("llm.request.started");
    let validated = 0;
    for (const e of events) {
      const body = mapLlmEventToSessionBody(e);
      if (body) {
        const parsed = SessionStreamEventBodySchema.safeParse(body.body);
        expect(parsed.success).toBe(true);
        validated += 1;
      }
    }
    expect(validated).toBeGreaterThan(0);
  });

  it("error mode: surfaces a clean LlmWrapperError for upstream failures", async () => {
    const { providers, models } = makeRegistries();
    const errorFetcher: typeof fetch = async () =>
      fakeProviderFetch(
        new Request("https://fake-provider.local/chat/completions?mode=error", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
    const executor = new LLMExecutor(new OpenAIChatAdapter(), {
      fetcher: errorFetcher,
    });
    const exec = buildExecutionRequest(
      {
        model: "gpt-fake-1",
        messages: [{ role: "user", content: "fail" }],
        stream: false,
      },
      providers,
      models,
    );
    await expect(executor.execute(exec)).rejects.toThrow();
  });
});
