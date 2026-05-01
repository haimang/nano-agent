import { authenticateRequest } from "../../auth.js";
import { jsonPolicyError } from "../../policy/authority.js";
import type { OrchestratorCoreEnv } from "../env.js";

type AuthSuccess = Awaited<ReturnType<typeof authenticateRequest>> & { ok: true };

export function readAuthTeam(auth: AuthSuccess): string | null {
  return auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid ?? null;
}

export function isTeamOwner(auth: AuthSuccess): boolean {
  return Number(auth.value.snapshot.membership_level ?? 0) >= 100;
}

export async function authenticateDebugRequest(request: Request, env: OrchestratorCoreEnv) {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth;
  const teamUuid = readAuthTeam(auth);
  if (!teamUuid) {
    return {
      ok: false as const,
      response: jsonPolicyError(
        403,
        "missing-team-claim",
        "team_uuid missing from auth snapshot",
        auth.value.trace_uuid,
      ),
    };
  }
  return auth;
}

export function readAccessToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }
  return null;
}

export function readDeviceMetadata(request: Request): Record<string, unknown> {
  const deviceUuid = request.headers.get("x-device-uuid");
  const deviceLabel = request.headers.get("x-device-label");
  const deviceKind = request.headers.get("x-device-kind");
  return {
    ...(typeof deviceUuid === "string" && deviceUuid.length > 0 ? { device_uuid: deviceUuid } : {}),
    ...(typeof deviceLabel === "string" && deviceLabel.length > 0 ? { device_label: deviceLabel } : {}),
    ...(typeof deviceKind === "string" && deviceKind.length > 0 ? { device_kind: deviceKind } : {}),
  };
}
