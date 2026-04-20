/**
 * /headers/dump — binding-F02 re-validation (lowercase header law).
 *
 * Returns all headers as received so the caller can confirm
 * `x-nacp-*` headers survive the service binding unchanged except
 * for platform-level lowercasing. This is the canonical B6
 * binding-F02 closure evidence.
 */
export async function handleHeaderDump(request: Request): Promise<Response> {
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });
  return Response.json({
    observedKeys: Object.keys(headers).sort(),
    headers,
    receivedAt: new Date().toISOString(),
  });
}
