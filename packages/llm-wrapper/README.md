# @nano-agent/llm-wrapper

Provider-agnostic LLM wrapper for nano-agent. Owns the canonical request /
message / event model, the adapter seam to OpenAI-compatible Chat
Completions APIs, the local-fetch executor (with retry, timeout, `on-429`
key rotation and `Retry-After` handling), attachment planning, and the
bridge from LLM events into `@nano-agent/nacp-session` client-visible
stream bodies.

---

## What's in scope (v1)

- Canonical types: `CanonicalMessage`, `CanonicalContentPart`,
  `CanonicalLLMRequest`, `CanonicalLLMResult`, `NormalizedLLMEvent`.
- `ProviderRegistry` + `ModelRegistry` with capability query (`stream`,
  `tools`, `vision`, `jsonSchema`) and two key-rotation policies:
  - `round-robin` — every request advances the key cursor.
  - `on-429` — the cursor only advances when the executor calls
    `rotateApiKey()` after a 429 response.
- `ChatCompletionAdapter` interface, plus a single v1 adapter —
  `OpenAIChatAdapter` — that works against any OpenAI Chat-Completions
  compatible endpoint (OpenAI, Azure OpenAI, …).
- `LLMExecutor` — local-fetch HTTP driver with:
  - configurable timeout, capped via `maxRetries` (provider config wins
    over constructor option; `maxRetries: 0` means "exactly one attempt"),
  - exponential backoff with a `Retry-After` floor,
  - `on-429` key rotation through the injected `ProviderRegistry`,
  - SSE streaming that emits `llm.request.started` as a lifecycle anchor,
- `AttachmentPlanner` with the worker-native route vocabulary
  (`inline | signed-url | proxy-url | prepared-text | reject`).
- `PreparedArtifactRef` that is structurally aligned with
  `@nano-agent/workspace-context-artifacts`'s `PreparedArtifactRefSchema`.
- Session-stream adapter that maps every `NormalizedLLMEvent` to a body
  in the 9-kind `SessionStreamEventBodySchema` catalog (no invented
  kinds — `llm.tool_call` is encoded inside `llm.delta`
  `content_type: "tool_use_start"`).
- `InferenceGateway` interface seam for future remote-gateway transport.

## What's NOT in scope (v1)

- Anthropic native Messages adapter.
- OpenAI Responses API.
- Provider-native WebSocket / realtime transport.
- Full `llm.invoke` NACP-Core domain freeze.
- Provider SDK fleet and complex auth-helper ecosystems.
- OCR / PDF parsing / CSV summarisation implementations.
- Sub-agent orchestration / workflow routing.
- Automatic provider routing / A-B / cost optimisation.
- Real remote inference-gateway worker wiring.
- Arbitrary binary inline submission (attachments are still MIME-gated).

---

## Quick start

```ts
import {
  OpenAIChatAdapter,
  LLMExecutor,
  ProviderRegistry,
  ModelRegistry,
  buildExecutionRequest,
  mapLlmEventToSessionBody,
} from "@nano-agent/llm-wrapper";

const providers = new ProviderRegistry();
providers.register({
  name: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKeys: [process.env.OPENAI_KEY_A!, process.env.OPENAI_KEY_B!],
  keyRotationPolicy: "on-429",
  retryConfig: { maxRetries: 3, baseDelayMs: 200 },
});

const models = new ModelRegistry();
models.register({
  modelId: "gpt-4o",
  provider: "openai",
  supportsStream: true,
  supportsTools: true,
  supportsVision: true,
  supportsJsonSchema: true,
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
});

const executor = new LLMExecutor(new OpenAIChatAdapter(), { providerRegistry: providers });

const exec = buildExecutionRequest(
  {
    model: "gpt-4o",
    messages: [{ role: "user", content: "Hello!" }],
    stream: true,
  },
  providers,
  models,
);

for await (const event of executor.executeStream(exec)) {
  const body = mapLlmEventToSessionBody(event);
  if (body) {
    // `body.body` is a `SessionStreamEventBody` value — feed it to the
    // session DO's WebSocket push pipeline.
  }
}
```

---

## Fixtures

`fixtures/` contains the declarative data that the integration tests
consume. Use them as the canonical truth when adding new stream /
non-stream / provider cases:

```
fixtures/
  provider-profiles/
    openai.json
    azure.json
  stream/
    openai-hello-world.sse
    openai-tool-call.sse
  non-stream/
    openai-success.json
    openai-tool-calls.json
```

## Scripts

```
npm run build       # tsc → dist/
npm run typecheck
npm run test
npm run test:coverage
```
