/**
 * Fake hook worker fixture (A5 Phase 2 / P5-02 handoff).
 *
 * Implements the JSON-over-fetch contract that
 * `packages/session-do-runtime/src/remote-bindings.ts::makeHookTransport`
 * speaks:
 *   POST /hooks/emit
 *     body: { handlerId, event, emitBody, context }
 *     200:  hook.outcome body  ({ ok: bool, ... })
 *
 * Modes via search params on the request URL:
 *   - `?mode=continue` (default) → `{ ok: true, additional_context: "ok" }`
 *   - `?mode=block`              → `{ ok: false, block: { reason: "test" } }`
 *   - `?mode=throw`              → 500 (transport-error simulation)
 *   - `?mode=delay&ms=...`       → wait `ms` ms then continue
 */

interface HookEmitEnvelope {
  handlerId: string;
  event: string;
  emitBody: unknown;
  context: unknown;
}

export async function fakeHookFetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/hooks/emit" || request.method !== "POST") {
    return new Response(JSON.stringify({ error: "not-found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  const mode = url.searchParams.get("mode") ?? "continue";

  if (mode === "throw") {
    return new Response(
      JSON.stringify({ error: "fake hook worker simulated failure" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  if (mode === "delay") {
    const ms = Number(url.searchParams.get("ms") ?? "10");
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  let envelope: HookEmitEnvelope = {
    handlerId: "unknown",
    event: "PreToolUse",
    emitBody: {},
    context: {},
  };
  try {
    envelope = (await request.json()) as HookEmitEnvelope;
  } catch {
    /* fall through — empty envelope is still valid for tests */
  }

  if (mode === "block") {
    return new Response(
      JSON.stringify({
        ok: false,
        block: { reason: `blocked by fake worker for ${envelope.handlerId}` },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, additional_context: "ok" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

export default {
  async fetch(request: Request): Promise<Response> {
    return fakeHookFetch(request);
  },
};

/** Build a ServiceBindingLike that targets the fake hook worker. */
export function makeFakeHookBinding(): { fetch: (req: Request) => Promise<Response> } {
  return { fetch: fakeHookFetch };
}
