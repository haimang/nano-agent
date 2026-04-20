/**
 * /hooks/dispatch — binding-F03 re-validation (hook callback latency).
 *
 * Accepts a hook event payload, immediately ACKs with a timestamp,
 * and optionally injects a small artificial latency. The caller
 * computes round-trip latency and compares to the shipped B5 hooks
 * dispatcher baseline.
 */

interface HookDispatchParams {
  readonly event?: string;
  readonly latencyMs?: number;
}

export async function handleHookDispatch(request: Request): Promise<Response> {
  const params: HookDispatchParams = (await request
    .json()
    .catch(() => ({}))) as HookDispatchParams;
  const latencyMs = typeof params.latencyMs === "number" ? params.latencyMs : 0;
  if (latencyMs > 0) {
    await new Promise((res) => setTimeout(res, latencyMs));
  }
  return Response.json({
    ok: true,
    event: params.event ?? "(unspecified)",
    dispatchedAt: new Date().toISOString(),
  });
}
