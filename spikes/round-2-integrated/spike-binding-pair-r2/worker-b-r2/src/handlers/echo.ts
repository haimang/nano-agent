/**
 * /echo — minimal round-trip for binding latency + cancellation
 * baseline. Identical in shape to the Round 1 handler so the caller
 * can compare timings between bare-metal and integrated modes.
 */
export async function handleEcho(request: Request): Promise<Response> {
  const body = await request.text();
  return new Response(body, {
    status: 200,
    headers: {
      "content-type":
        request.headers.get("content-type") ?? "application/octet-stream",
      "x-spike-echoed-at": new Date().toISOString(),
    },
  });
}
