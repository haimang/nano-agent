const UPSTREAM_BASE_URL =
  (typeof process !== "undefined" ? process.env?.VITE_NANO_BASE_URL : undefined) ??
  "https://nano-agent-orchestrator-core-preview.haimang.workers.dev";

export async function onRequest(context: {
  request: Request;
  params: { path?: string[] };
}) {
  const { request, params } = context;
  const pathSegments = params.path ?? [];
  const path = "/" + pathSegments.join("/");
  const url = new URL(path, UPSTREAM_BASE_URL);
  request.url.split("?")[1]
    ?.split("&")
    .forEach((p) => {
      const [k, v] = p.split("=");
      if (k) url.searchParams.set(k, v ?? "");
    });

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
  responseHeaders.set("access-control-allow-origin", "*");
  responseHeaders.set("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  responseHeaders.set("access-control-allow-headers", "Authorization, Content-Type, x-trace-uuid");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}
