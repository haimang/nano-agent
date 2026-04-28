const UPSTREAM_BASE_URL =
  (typeof process !== "undefined" ? process.env?.VITE_NANO_BASE_URL : undefined) ??
  "https://nano-agent-orchestrator-core-preview.haimang.workers.dev";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, x-trace-uuid",
};

export async function onRequest(context: {
  request: Request;
  params: { path?: string[] };
}) {
  const { request, params } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const pathSegments = params.path ?? [];
  const path = "/" + pathSegments.join("/");
  const url = new URL(path, UPSTREAM_BASE_URL);

  const sourceUrl = new URL(request.url);
  for (const [k, v] of sourceUrl.searchParams) {
    url.searchParams.set(k, v);
  }

  const headers = new Headers(request.headers);
  headers.set("x-forwarded-for", request.headers.get("cf-connecting-ip") ?? "unknown");

  const upstreamResponse = await fetch(url.toString(), {
    method: request.method,
    headers,
    body:
      request.method !== "GET" && request.method !== "HEAD"
        ? await request.text()
        : undefined,
  });

  const responseHeaders = new Headers(upstreamResponse.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    responseHeaders.set(k, v);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}
