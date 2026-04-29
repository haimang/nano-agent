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

async function readEnvelope(url, body, extraHeaders = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-trace-uuid": randomSessionId(),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { response, json };
}

function toAuthBundle(token, traceUuid) {
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
  };
}

export async function registerOrchestratorAccount(options = {}) {
  const base = workerUrl("orchestrator-core");
  assert.ok(base, "missing orchestrator-core live URL");
  const identity = randomSessionId();
  const email = options.email ?? `${identity}@nano-agent.test`;
  const password = options.password ?? `NanoAgent!${identity.slice(0, 12)}`;
  const displayName = options.displayName ?? `live-${identity.slice(0, 8)}`;
  const traceUuid = randomSessionId();
  const deviceHeaders = {
    ...(options.deviceUuid ? { "x-device-uuid": options.deviceUuid } : {}),
    ...(options.deviceLabel ? { "x-device-label": options.deviceLabel } : {}),
    ...(options.deviceKind ? { "x-device-kind": options.deviceKind } : {}),
  };
  const register = await readEnvelope(
    `${base}/auth/register`,
    {
      email,
      password,
      display_name: displayName,
    },
    deviceHeaders,
  );
  assert.equal(
    register.response.status,
    200,
    `register failed for ${email}: ${JSON.stringify(register.json)}`,
  );
  assert.equal(register.json?.ok, true, `register envelope not ok for ${email}`);
  const token = register.json?.data?.tokens?.access_token;
  const refreshToken = register.json?.data?.tokens?.refresh_token;
  const teamUuid = register.json?.data?.team?.team_uuid;
  const userUuid = register.json?.data?.user?.user_uuid;
  const issuedDeviceUuid = register.json?.data?.snapshot?.device_uuid;
  assert.equal(typeof token, "string", "register did not return access_token");
  assert.equal(typeof refreshToken, "string", "register did not return refresh_token");
  assert.equal(typeof teamUuid, "string", "register did not return team_uuid");
  assert.equal(typeof userUuid, "string", "register did not return user_uuid");
  return {
    email,
    password,
    displayName,
    realm: options.realm ?? "live-e2e",
    teamUuid,
    userUuid,
    deviceUuid: issuedDeviceUuid,
    refreshToken,
    ...toAuthBundle(token, traceUuid),
  };
}

export async function loginOrchestratorAccount(options) {
  const base = workerUrl("orchestrator-core");
  assert.ok(base, "missing orchestrator-core live URL");
  assert.ok(options?.email, "loginOrchestratorAccount requires email");
  assert.ok(options?.password, "loginOrchestratorAccount requires password");
  const traceUuid = randomSessionId();
  const deviceHeaders = {
    ...(options.deviceUuid ? { "x-device-uuid": options.deviceUuid } : {}),
    ...(options.deviceLabel ? { "x-device-label": options.deviceLabel } : {}),
    ...(options.deviceKind ? { "x-device-kind": options.deviceKind } : {}),
  };
  const login = await readEnvelope(
    `${base}/auth/login`,
    {
      email: options.email,
      password: options.password,
    },
    deviceHeaders,
  );
  assert.equal(
    login.response.status,
    200,
    `login failed for ${options.email}: ${JSON.stringify(login.json)}`,
  );
  assert.equal(login.json?.ok, true, `login envelope not ok for ${options.email}`);
  const token = login.json?.data?.tokens?.access_token;
  const refreshToken = login.json?.data?.tokens?.refresh_token;
  const teamUuid = login.json?.data?.team?.team_uuid;
  const userUuid = login.json?.data?.user?.user_uuid;
  const issuedDeviceUuid = login.json?.data?.snapshot?.device_uuid;
  assert.equal(typeof token, "string", "login did not return access_token");
  assert.equal(typeof refreshToken, "string", "login did not return refresh_token");
  assert.equal(typeof teamUuid, "string", "login did not return team_uuid");
  assert.equal(typeof userUuid, "string", "login did not return user_uuid");
  return {
    email: options.email,
    password: options.password,
    realm: options.realm ?? "live-e2e",
    teamUuid,
    userUuid,
    deviceUuid: issuedDeviceUuid,
    refreshToken,
    ...toAuthBundle(token, traceUuid),
  };
}

export async function createOrchestratorAuth(realm = "live-e2e") {
  const base = workerUrl("orchestrator-core");
  assert.ok(base, "missing orchestrator-core live URL");
  try {
    const registered = await registerOrchestratorAccount({ realm });
    const login = await loginOrchestratorAccount({
      realm,
      email: registered.email,
      password: registered.password,
    });
    return {
      token: login.token,
      traceUuid: login.traceUuid,
      authHeaders: login.authHeaders,
      jsonHeaders: login.jsonHeaders,
      teamUuid: login.teamUuid,
      realm,
    };
  } catch {
    // fall through to local JWT fallback below
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
