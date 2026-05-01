import { jsonPolicyError } from "../policy/authority.js";
import { tryHandleAuthRoute } from "./routes/auth.js";
import { tryHandleCatalogRoute } from "./routes/catalog.js";
import { tryHandleHealthDebugRoute } from "./routes/debug.js";
import { tryHandleMeRoute } from "./routes/me.js";
import { tryHandlePublicModelRoute, tryHandleSessionModelRoute } from "./routes/models.js";
import { tryHandleSessionBridgeRoute } from "./routes/session-bridge.js";
import { tryHandleSessionContextRoute } from "./routes/session-context.js";
import { tryHandleSessionControlRoute } from "./routes/session-control.js";
import { tryHandleSessionFilesRoute } from "./routes/session-files.js";
import { ensureTenantConfigured } from "./shared/request.js";
import type { OrchestratorCoreEnv } from "./env.js";

export async function dispatchFacadeRoute(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response> {
  const healthDebug = await tryHandleHealthDebugRoute(request, env);
  if (healthDebug) return healthDebug;

  const auth = await tryHandleAuthRoute(request, env);
  if (auth) return auth;

  const catalog = await tryHandleCatalogRoute(request, env);
  if (catalog) return catalog;

  const me = await tryHandleMeRoute(request, env);
  if (me) return me;

  const publicModels = await tryHandlePublicModelRoute(request, env);
  if (publicModels) return publicModels;

  const sessionContext = await tryHandleSessionContextRoute(request, env);
  if (sessionContext) return sessionContext;

  const tenantError = ensureTenantConfigured(env);
  if (tenantError) return tenantError;

  const sessionFiles = await tryHandleSessionFilesRoute(request, env);
  if (sessionFiles) return sessionFiles;

  const sessionControl = await tryHandleSessionControlRoute(request, env);
  if (sessionControl) return sessionControl;

  const sessionModel = await tryHandleSessionModelRoute(request, env);
  if (sessionModel) return sessionModel;

  const sessionBridge = await tryHandleSessionBridgeRoute(request, env);
  if (sessionBridge) return sessionBridge;

  return jsonPolicyError(404, "not-found", "route not found");
}
