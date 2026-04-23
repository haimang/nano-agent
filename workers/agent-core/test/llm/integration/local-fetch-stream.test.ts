/**
 * Integration — end-to-end local-fetch SSE path.
 *
 * Drives `canonical → adapter → executor → normalizer → session-stream
 * adapter` off fixtures in `fixtures/stream/` and `fixtures/provider-profiles/`,
 * and asserts that the resulting session stream body parses under the
 * real `@haimang/nacp-session` `SessionStreamEventBodySchema`.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SessionStreamEventBodySchema } from "@haimang/nacp-session";
import { OpenAIChatAdapter } from "../../../src/llm/adapters/openai-chat.js";
import { LLMExecutor } from "../../../src/llm/executor.js";
import {
  ProviderRegistry,
  type ProviderProfile,
} from "../../../src/llm/registry/providers.js";
import { ModelRegistry } from "../../../src/llm/registry/models.js";
import { buildExecutionRequest } from "../../../src/llm/request-builder.js";
import { mapLlmEventToSessionBody } from "../../../src/llm/session-stream-adapter.js";
import type { NormalizedLLMEvent } from "../../../src/llm/canonical.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(here, "..", "..", "..", "fixtures", "llm");

function loadProfile(name: string): ProviderProfile {
  const raw = readFileSync(join(FIXTURE_DIR, "provider-profiles", `${name}.json`), "utf8");
  return JSON.parse(raw) as ProviderProfile;
}

function loadSseChunks(file: string): string[] {
  const raw = readFileSync(join(FIXTURE_DIR, "stream", file), "utf8");
  // Preserve the fixture's blank-line separation between SSE frames —
  // the executor's chunk-parser runs on whole lines, so delivering it
  // the same way a browser would is the right baseline.
  return raw
    .split(/\n\n/)
    .map((block) => `${block.trim()}\n\n`)
    .filter((block) => block.trim().length > 0);
}

function mockStreamFetch(chunks: string[]): typeof fetch {
  let i = 0;
  const encoder = new TextEncoder();
  const reader = {
    read: vi.fn().mockImplementation(() => {
      if (i < chunks.length) {
        const value = encoder.encode(chunks[i]!);
        i++;
        return Promise.resolve({ done: false, value });
      }
      return Promise.resolve({ done: true, value: undefined });
    }),
    releaseLock: vi.fn(),
  };
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    body: { getReader: () => reader },
    headers: new Headers(),
  }) as unknown as typeof fetch;
}

function registerFixture(profile: ProviderProfile): {
  providers: ProviderRegistry;
  models: ModelRegistry;
} {
  const providers = new ProviderRegistry();
  providers.register(profile);
  const models = new ModelRegistry();
  models.register({
    modelId: "gpt-4o",
    provider: profile.name,
    supportsStream: true,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
  });
  return { providers, models };
}

describe("integration: local-fetch stream → session stream", () => {
  it("hello-world SSE: every session body parses under SessionStreamEventBodySchema", async () => {
    const profile = loadProfile("openai");
    const { providers, models } = registerFixture(profile);

    const fetcher = mockStreamFetch(loadSseChunks("openai-hello-world.sse"));
    const executor = new LLMExecutor(new OpenAIChatAdapter(), { fetcher });

    const exec = buildExecutionRequest(
      {
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hello?" }],
        stream: true,
      },
      providers,
      models,
    );

    const events: NormalizedLLMEvent[] = [];
    for await (const e of executor.executeStream(exec)) events.push(e);

    // First event is always the llm.request.started lifecycle anchor.
    expect(events[0]?.type).toBe("llm.request.started");

    // Every non-null session body must be schema-valid.
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

  it("tool-call SSE: tool_call events flow through as schema-valid llm.delta bodies", async () => {
    const profile = loadProfile("openai");
    const { providers, models } = registerFixture(profile);

    const fetcher = mockStreamFetch(loadSseChunks("openai-tool-call.sse"));
    const executor = new LLMExecutor(new OpenAIChatAdapter(), { fetcher });

    const exec = buildExecutionRequest(
      {
        model: "gpt-4o",
        messages: [{ role: "user", content: "What's the weather in NYC?" }],
        stream: true,
        tools: [{ type: "function", function: { name: "get_weather" } }],
      },
      providers,
      models,
    );

    const events: NormalizedLLMEvent[] = [];
    for await (const e of executor.executeStream(exec)) events.push(e);

    const toolEvents = events.filter((e) => e.type === "tool_call");
    expect(toolEvents.length).toBeGreaterThan(0);

    for (const e of toolEvents) {
      const body = mapLlmEventToSessionBody(e);
      expect(body).not.toBeNull();
      const parsed = SessionStreamEventBodySchema.safeParse(body!.body);
      expect(parsed.success).toBe(true);
    }
  });
});
