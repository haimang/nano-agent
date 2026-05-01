import {
  facadeFromAuthEnvelope,
  type OrchestratorAuthRpcService,
} from "@haimang/orchestrator-auth-contract";
import { authenticateRequest } from "../../auth.js";
import { jsonPolicyError, readTraceUuid } from "../../policy/authority.js";
import type { OrchestratorCoreEnv } from "../env.js";
import { readAccessToken, readDeviceMetadata } from "../shared/auth.js";
import { parseBody } from "../shared/request.js";

type AuthAction =
  | "register"
  | "login"
  | "refresh"
  | "verify"
  | "me"
  | "resetPassword"
  | "wechatLogin"
  | "revokeApiKey";

function parseAuthRoute(request: Request): AuthAction | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  if (method === "POST" && pathname === "/auth/register") return "register";
  if (method === "POST" && pathname === "/auth/login") return "login";
  if (method === "POST" && pathname === "/auth/refresh") return "refresh";
  if (method === "POST" && pathname === "/auth/verify") return "verify";
  if (method === "POST" && pathname === "/auth/password/reset") return "resetPassword";
  if (method === "POST" && pathname === "/auth/wechat/login") return "wechatLogin";
  if (method === "POST" && pathname === "/auth/api-keys/revoke") return "revokeApiKey";
  if ((method === "GET" || method === "POST") && (pathname === "/auth/me" || pathname === "/me")) {
    return "me";
  }
  return null;
}

async function proxyAuthRoute(
  request: Request,
  env: OrchestratorCoreEnv,
  action: AuthAction,
): Promise<Response> {
  if (!env.ORCHESTRATOR_AUTH) {
    return jsonPolicyError(503, "worker-misconfigured", "ORCHESTRATOR_AUTH binding must be configured");
  }
  const traceUuid = readTraceUuid(request) ?? crypto.randomUUID();
  const meta = {
    trace_uuid: traceUuid,
    caller: "orchestrator-core" as const,
  };
  const body = action === "me" ? {} : await parseBody(request, true);
  if (action !== "me" && body === null) {
    return jsonPolicyError(400, "invalid-auth-body", "auth routes require a JSON body");
  }

  const accessToken = readAccessToken(request);
  const deviceMetadata = readDeviceMetadata(request);
  let input =
    action === "me" || action === "verify"
      ? { access_token: accessToken }
      : action === "resetPassword"
        ? { ...(body ?? {}), access_token: accessToken }
        : { ...(body ?? {}), ...deviceMetadata };

  if (action === "revokeApiKey") {
    const keyId = (body as { key_id?: unknown } | null)?.key_id;
    if (typeof keyId !== "string" || !keyId.startsWith("nak_")) {
      return jsonPolicyError(400, "invalid-input", "key_id must start with nak_", traceUuid);
    }
    const auth = await authenticateRequest(request, env);
    if (!auth.ok) return auth.response;
    const teamUuid = auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid;
    if (!teamUuid) {
      return jsonPolicyError(403, "missing-team-claim", "team_uuid missing from auth snapshot", traceUuid);
    }
    input = { ...(body ?? {}), team_uuid: teamUuid, user_uuid: auth.value.user_uuid };
  }

  const rpc = env.ORCHESTRATOR_AUTH as OrchestratorAuthRpcService & Fetcher;
  const envelope =
    action === "register"
      ? await rpc.register(input, meta)
      : action === "login"
        ? await rpc.login(input, meta)
        : action === "refresh"
          ? await rpc.refresh(input, meta)
          : action === "verify"
            ? await rpc.verifyToken(input, meta)
            : action === "me"
              ? await rpc.me(input, meta)
              : action === "resetPassword"
                ? await rpc.resetPassword(input, meta)
                : action === "revokeApiKey"
                  ? await rpc.revokeApiKey(input, meta)
                  : await rpc.wechatLogin({ ...input, ...deviceMetadata }, meta);

  const facade = facadeFromAuthEnvelope(
    envelope as
      | { readonly ok: true; readonly data: unknown }
      | {
          readonly ok: false;
          readonly error: { readonly code: string; readonly status: number; readonly message: string };
        },
    traceUuid,
  );
  return Response.json(facade, {
    status: facade.ok ? 200 : facade.error.status,
    headers: { "x-trace-uuid": traceUuid },
  });
}

export async function tryHandleAuthRoute(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response | null> {
  const authRoute = parseAuthRoute(request);
  return authRoute ? proxyAuthRoute(request, env, authRoute) : null;
}
