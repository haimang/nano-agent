import { readTraceUuid } from "../../policy/authority.js";
import type { OrchestratorCoreEnv } from "../env.js";

type CatalogKind = "skills" | "commands" | "agents";

function parseCatalogRoute(request: Request): CatalogKind | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  if (method !== "GET") return null;
  if (pathname === "/catalog/skills") return "skills";
  if (pathname === "/catalog/commands") return "commands";
  if (pathname === "/catalog/agents") return "agents";
  return null;
}

async function handleCatalog(
  request: Request,
  _env: OrchestratorCoreEnv,
  kind: CatalogKind,
): Promise<Response> {
  const traceUuid = readTraceUuid(request) ?? crypto.randomUUID();
  const { CATALOG_SKILLS, CATALOG_COMMANDS, CATALOG_AGENTS } = await import("../../catalog-content.js");
  const data = (() => {
    switch (kind) {
      case "skills":
        return { skills: CATALOG_SKILLS };
      case "commands":
        return { commands: CATALOG_COMMANDS };
      case "agents":
        return { agents: CATALOG_AGENTS };
    }
  })();
  return Response.json(
    { ok: true, data, trace_uuid: traceUuid },
    { status: 200, headers: { "x-trace-uuid": traceUuid } },
  );
}

export async function tryHandleCatalogRoute(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response | null> {
  const catalogRoute = parseCatalogRoute(request);
  return catalogRoute ? handleCatalog(request, env, catalogRoute) : null;
}
