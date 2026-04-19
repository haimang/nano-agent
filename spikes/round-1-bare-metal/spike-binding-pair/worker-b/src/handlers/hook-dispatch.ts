/**
 * worker-b /handle/hook-dispatch — emulates a remote hook callback.
 *
 * Used by V3-binding-hooks-callback to measure cross-worker hook
 * dispatch latency and to verify failure modes.
 *
 * Request body shape (loose, probe-driven):
 *   { hookEvent: string, eventPayload: unknown, mode?: "ok"|"throw"|"slow" }
 *
 * The contract this probe is testing is the seam shape used by
 * `packages/hooks/src/runtimes/service-binding.ts` — but this handler
 * does NOT import that code (纪律 7); it mirrors the shape only.
 */

interface HookDispatchBody {
  hookEvent?: string;
  eventPayload?: unknown;
  mode?: "ok" | "throw" | "slow";
  slowMs?: number;
}

export async function handleHookDispatch(request: Request): Promise<Response> {
  const t0 = Date.now();
  let body: HookDispatchBody = {};
  try {
    body = (await request.json()) as HookDispatchBody;
  } catch {
    /* empty body is allowed */
  }

  const mode = body.mode ?? "ok";

  if (mode === "throw") {
    return new Response(
      JSON.stringify({
        ok: false,
        handler: "hook-dispatch",
        mode: "throw",
        thrown: "intentional-failure-from-hook",
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  if (mode === "slow") {
    await new Promise((r) => setTimeout(r, body.slowMs ?? 1500));
  }

  // R2 code fix (B1-code-reviewed-by-GPT §R2): anchor traversal on
  // hook-dispatch path MUST echo received headers so the probe can
  // verify anchor propagation on the real hook dispatch route (not on
  // the unrelated /handle/header-dump route).
  const receivedHeaders: Record<string, string> = {};
  for (const [name, value] of request.headers.entries()) {
    receivedHeaders[name] = value;
  }

  // Default ok response — emulates a hook that returns an outcome.
  return Response.json(
    {
      ok: true,
      handler: "hook-dispatch",
      mode,
      hookEvent: body.hookEvent ?? "(none)",
      outcome: { ok: true, additionalContext: "stub-from-spike" },
      latencyMs: Date.now() - t0,
      // R2 code fix: anchor probe consumes this field to verify headers
      // on the hook-dispatch path specifically.
      receivedHeaders,
    },
    { headers: { "x-spike-handler": "hook-dispatch" } },
  );
}
