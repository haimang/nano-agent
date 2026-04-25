import assert from "node:assert/strict";
import { randomSessionId, workerUrl } from "./live.mjs";
import { signOrchestratorJwt } from "./orchestrator-jwt.mjs";

const TEAM_UUID =
  process.env.NANO_AGENT_TEST_TEAM_UUID ??
  process.env.TEAM_UUID ??
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JWT_KID = process.env.NANO_AGENT_ORCHESTRATOR_JWT_KID ?? process.env.JWT_SIGNING_KID ?? "v1";
const LOCAL_JWT_SECRET =
  process.env.NANO_AGENT_ORCHESTRATOR_JWT_SECRET ??
  process.env[`JWT_SIGNING_KEY_${JWT_KID}`] ??
  process.env.JWT_SIGNING_KEY_v1;

async function readEnvelope(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-trace-uuid": randomSessionId(),
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { response, json };
}

export async function createOrchestratorAuth(realm = "live-e2e") {
  const base = workerUrl("orchestrator-core");
  assert.ok(base, "missing orchestrator-core live URL");
  const identity = randomSessionId();
  const email = `${identity}@nano-agent.test`;
  const password = `NanoAgent!${identity.slice(0, 12)}`;
  const displayName = `live-${identity.slice(0, 8)}`;
  const register = await readEnvelope(`${base}/auth/register`, {
    email,
    password,
    display_name: displayName,
  });
  const traceUuid = randomSessionId();
  if (register.response.status === 200 && register.json?.ok === true) {
    const login = await readEnvelope(`${base}/auth/login`, {
      email,
      password,
    });
    if (login.response.status === 200 && login.json?.ok === true) {
      const issuedTeamUuid = login.json?.data?.team?.team_uuid;
      const token = login.json?.data?.tokens?.access_token;
      if (issuedTeamUuid === TEAM_UUID && typeof token === "string") {
        return {
          token,
          traceUuid,
          authHeaders: {
            authorization: `Bearer ${token}`,
            "x-trace-uuid": traceUuid,
          },
          jsonHeaders: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-trace-uuid": traceUuid,
          },
          teamUuid: TEAM_UUID,
          realm,
        };
      }
    }
  }

  assert.ok(
    LOCAL_JWT_SECRET,
    `auth flow unavailable for deploy tenant and no local JWT secret fallback is configured (register=${JSON.stringify(register.json)})`,
  );
  const userUuid = randomSessionId();
  const token = await signOrchestratorJwt(
    {
      sub: userUuid,
      user_uuid: userUuid,
      team_uuid: TEAM_UUID,
      realm,
    },
    LOCAL_JWT_SECRET,
    3600,
    JWT_KID ? { kid: JWT_KID } : {},
  );
  return {
    token,
    traceUuid,
    authHeaders: {
      authorization: `Bearer ${token}`,
      "x-trace-uuid": traceUuid,
    },
    jsonHeaders: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-trace-uuid": traceUuid,
    },
    teamUuid: TEAM_UUID,
    realm,
  };
}
