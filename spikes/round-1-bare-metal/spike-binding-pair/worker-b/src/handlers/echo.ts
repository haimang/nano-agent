/**
 * worker-b /handle/echo — minimal latency baseline target.
 *
 * Used by V3-binding-latency-cancellation probe to measure base
 * service-binding RTT. Echos the request body back with timing.
 */

export async function handleEcho(request: Request): Promise<Response> {
  const t0 = Date.now();
  const body = request.method === "POST" ? await request.text() : "";
  return Response.json(
    {
      ok: true,
      handler: "echo",
      receivedBytes: body.length,
      receivedAt: t0,
      respondedAt: Date.now(),
    },
    { headers: { "x-spike-handler": "echo" } },
  );
}
