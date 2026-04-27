export interface AuthWorkerProbeResponse {
  readonly worker: "orchestrator-auth";
  readonly status: "ok";
  readonly worker_version: string;
  readonly public_business_routes: false;
  readonly rpc_surface: true;
  readonly d1_binding: boolean;
}

export interface AuthProbeEnv {
  readonly NANO_AGENT_DB?: D1Database;
  readonly ENVIRONMENT?: string;
  readonly WORKER_VERSION?: string;
}

export function createProbeResponse(env: AuthProbeEnv): AuthWorkerProbeResponse {
  return {
    worker: "orchestrator-auth",
    status: "ok",
    worker_version: env.WORKER_VERSION ?? `orchestrator-auth@${env.ENVIRONMENT ?? "dev"}`,
    public_business_routes: false,
    rpc_surface: true,
    d1_binding: Boolean(env.NANO_AGENT_DB),
  };
}

export function handlePublicRequest(request: Request, env: AuthProbeEnv): Response {
  const pathname = new URL(request.url).pathname;
  if (request.method.toUpperCase() === "GET" && (pathname === "/" || pathname === "/health")) {
    return Response.json(createProbeResponse(env));
  }
  // ZX2 Phase 1 P1-03 (transport-profiles.md / binding-scope guard):
  // orchestrator-auth exposes RPC only via WorkerEntrypoint. fetch() must
  // never serve business routes. Aligned 401 envelope code with other
  // non-facade workers so monitors can grep the same string.
  return Response.json(
    {
      error: "binding-scope-forbidden",
      message:
        "orchestrator.auth does not expose public business routes; reach via WorkerEntrypoint RPC",
      worker: "orchestrator-auth",
    },
    { status: 401 },
  );
}
