/**
 * Fake capability worker fixture (A5 Phase 2 / P5-02 handoff).
 *
 * Implements the JSON-over-fetch contract spoken by
 * `packages/session-do-runtime/src/remote-bindings.ts::makeCapabilityTransport`:
 *   POST /capability/call
 *     body: { requestId, capabilityName, body }
 *     200:  tool.call.response body
 *   POST /capability/cancel
 *     body: { requestId, body: { reason? } }
 *     200:  empty body, used to ack the cancel
 *
 * Modes via search params:
 *   - `?mode=ok` (default) → success: `{ status: "ok", output: "fake-result" }`
 *   - `?mode=error`        → 500 (transport-error simulation)
 *   - `?mode=cancel`       → never resolves until the abort signal fires
 */

interface ToolCallEnvelope {
  requestId: string;
  capabilityName: string;
  body: unknown;
}

interface CancelEnvelope {
  requestId: string;
  body: { reason?: string };
}

export async function fakeCapabilityFetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "ok";

  if (request.method !== "POST") {
    return new Response("", { status: 405 });
  }

  if (url.pathname === "/capability/cancel") {
    let body: CancelEnvelope = { requestId: "?", body: {} };
    try {
      body = (await request.json()) as CancelEnvelope;
    } catch {
      /* fall through */
    }
    return new Response(JSON.stringify({ ok: true, ackedRequestId: body.requestId }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (url.pathname !== "/capability/call") {
    return new Response(JSON.stringify({ error: "not-found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  if (mode === "error") {
    return new Response(
      JSON.stringify({ error: "fake capability worker simulated failure" }),
      { status: 500, headers: { "content-type": "application/json" } },
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

  let envelope: ToolCallEnvelope = {
    requestId: "req-?",
    capabilityName: "unknown",
    body: {},
  };
  try {
    envelope = (await request.json()) as ToolCallEnvelope;
  } catch {
    /* fall through — empty envelope is fine for tests */
  }
  return new Response(
    JSON.stringify({
      status: "ok",
      output: `fake-result for ${envelope.capabilityName}`,
      capability_name: envelope.capabilityName,
      request_uuid: envelope.requestId,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

export default {
  async fetch(request: Request): Promise<Response> {
    return fakeCapabilityFetch(request);
  },
};

export function makeFakeCapabilityBinding(): { fetch: (req: Request) => Promise<Response> } {
  return { fetch: fakeCapabilityFetch };
}
