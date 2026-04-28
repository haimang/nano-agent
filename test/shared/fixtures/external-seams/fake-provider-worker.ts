/**
 * Fake LLM provider worker fixture (A5 Phase 3 / P3-01).
 *
 * Mirrors the OpenAI-compatible Chat Completions surface that
 * `@nano-agent/llm-wrapper`'s `OpenAIChatAdapter` already speaks. It
 * is deploy-shaped: the default export is a Cloudflare-Worker `fetch`
 * handler so it can be wired into a real `wrangler.jsonc` as
 * `FAKE_PROVIDER_WORKER` for the A6 deploy-shaped verification, while
 * also being directly callable from in-isolate tests.
 *
 * Determinism: the worker accepts a single configurable mode switch
 * via the request URL search params (`?mode=full|stream|error|cancel`)
 * so tests / smoke runs can pin a specific behaviour without writing
 * a different worker per scenario.
 */

// Minimal shape mirroring the relevant subset of OpenAI's Chat Completions
// request body. We only consume what the adapter sends.
interface ChatRequestBody {
  model?: string;
  messages?: Array<{ role: string; content: unknown }>;
  stream?: boolean;
  tools?: unknown[];
  // Allow any other field — we never touch them.
  [key: string]: unknown;
}

interface FakeProviderOptions {
  /** Constant text the fake assistant returns. */
  reply?: string;
  /** Number of token-sized SSE deltas when in `stream` mode. */
  streamChunks?: number;
  /** Optional simulated latency between SSE deltas (ms). */
  streamDelayMs?: number;
}

const DEFAULT_REPLY = "OK";
const DEFAULT_STREAM_CHUNKS = 3;
const DEFAULT_DELAY_MS = 0;

/** Build a non-streaming Chat Completions response. */
export function buildFullResponse(
  body: ChatRequestBody,
  opts: FakeProviderOptions = {},
): Record<string, unknown> {
  const reply = opts.reply ?? DEFAULT_REPLY;
  return {
    id: `chatcmpl-fake-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? "gpt-fake-1",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: reply,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: reply.length,
      total_tokens: 10 + reply.length,
    },
  };
}

/** Build the SSE chunks for a streaming Chat Completions response. */
export function buildStreamChunks(
  body: ChatRequestBody,
  opts: FakeProviderOptions = {},
): string[] {
  const reply = opts.reply ?? DEFAULT_REPLY;
  const chunkCount = Math.max(1, opts.streamChunks ?? DEFAULT_STREAM_CHUNKS);
  const chunkSize = Math.max(1, Math.ceil(reply.length / chunkCount));
  const id = `chatcmpl-fake-stream-${Date.now()}`;
  const model = body.model ?? "gpt-fake-1";
  const created = Math.floor(Date.now() / 1000);
  const out: string[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const slice = reply.slice(i * chunkSize, (i + 1) * chunkSize);
    if (!slice) continue;
    out.push(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: { role: i === 0 ? "assistant" : undefined, content: slice },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
  }
  out.push(
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
      ],
    })}\n\n`,
  );
  out.push("data: [DONE]\n\n");
  return out;
}

/**
 * Render an SSE stream as a `ReadableStream<Uint8Array>` body.
 *
 * A4-A5 review R6 (Kimi): when `streamDelayMs` is supplied, each
 * chunk is deferred via `setTimeout(delay)` so smoke/contract tests
 * can model slow providers. Zero / undefined keeps the previous
 * synchronous behaviour.
 */
export function buildStreamBody(
  chunks: readonly string[],
  opts: { streamDelayMs?: number } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const delay = opts.streamDelayMs ?? 0;
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      if (delay > 0) {
        await new Promise<void>((r) => setTimeout(r, delay));
      }
      controller.enqueue(encoder.encode(chunks[i]!));
      i += 1;
    },
  });
}

/**
 * Worker-style `fetch` handler. Routes:
 *   - `POST /chat/completions`  → OpenAI-compatible response (full or SSE)
 *   - `GET  /healthz`           → `{"ok":true}`
 *   - any other route           → 404
 *
 * Modes via search params:
 *   - `?mode=full`    → non-streaming response (default when body.stream is false)
 *   - `?mode=stream`  → SSE response (default when body.stream is true)
 *   - `?mode=error`   → 502 with a JSON error body (transport-error simulation)
 *   - `?mode=cancel`  → never resolves until the abort signal fires
 */
export async function fakeProviderFetch(
  request: Request,
  opts: FakeProviderOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/healthz" && request.method === "GET") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.pathname !== "/chat/completions" || request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: { message: "Not found" } }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }

  let body: ChatRequestBody = {};
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    body = {};
  }

  const explicitMode = url.searchParams.get("mode");
  const wantsStream = body.stream === true;
  const mode = explicitMode ?? (wantsStream ? "stream" : "full");

  if (mode === "error") {
    return new Response(
      JSON.stringify({
        error: {
          message: "fake provider — simulated upstream failure",
          type: "server_error",
        },
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  if (mode === "cancel") {
    return new Promise<Response>((_resolve, reject) => {
      request.signal.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  }

  if (mode === "stream") {
    const chunks = buildStreamChunks(body, opts);
    const stream = buildStreamBody(chunks, {
      streamDelayMs: opts.streamDelayMs,
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  const full = buildFullResponse(body, opts);
  return new Response(JSON.stringify(full), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Cloudflare Worker default export. Allows this fixture to be wired
 * via `wrangler.jsonc` as a service-binding target during A6.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    return fakeProviderFetch(request);
  },
};

/** Build a `ServiceBindingLike` that wraps the fake provider for tests. */
export function makeFakeProviderBinding(
  opts: FakeProviderOptions = {},
): { fetch: (request: Request) => Promise<Response> } {
  return {
    async fetch(request: Request): Promise<Response> {
      return fakeProviderFetch(request, opts);
    },
  };
}
