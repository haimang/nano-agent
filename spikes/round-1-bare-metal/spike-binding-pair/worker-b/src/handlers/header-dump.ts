/**
 * worker-b /handle/header-dump — header propagation probe target.
 *
 * Used by V3-binding-cross-seam-anchor to verify the 5 `x-nacp-*`
 * headers (and any others) survive the service binding hop.
 *
 * Returns ALL request headers so the probe can detect:
 *   - dropped headers
 *   - case-normalization
 *   - value truncation
 */

export async function handleHeaderDump(request: Request): Promise<Response> {
  const headers: Record<string, string> = {};
  for (const [name, value] of request.headers.entries()) {
    headers[name] = value;
  }
  return Response.json(
    {
      ok: true,
      handler: "header-dump",
      receivedHeaders: headers,
      headerCount: Object.keys(headers).length,
    },
    { headers: { "x-spike-handler": "header-dump" } },
  );
}
