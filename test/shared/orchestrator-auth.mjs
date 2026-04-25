import assert from "node:assert/strict";
import { randomSessionId } from "./live.mjs";
import { signOrchestratorJwt } from "./orchestrator-jwt.mjs";

const JWT_KID = process.env.NANO_AGENT_ORCHESTRATOR_JWT_KID ?? process.env.JWT_SIGNING_KID ?? "v1";
const JWT_SECRET =
  process.env.NANO_AGENT_ORCHESTRATOR_JWT_SECRET ??
  process.env[`JWT_SIGNING_KEY_${JWT_KID}`];
const TEAM_UUID =
  process.env.NANO_AGENT_TEST_TEAM_UUID ??
  process.env.TEAM_UUID ??
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export async function createOrchestratorAuth(realm = "live-e2e") {
  assert.ok(JWT_SECRET, "set NANO_AGENT_ORCHESTRATOR_JWT_SECRET for orchestrator live tests");
  const userUuid = randomSessionId();
  const token = await signOrchestratorJwt(
    { sub: userUuid, user_uuid: userUuid, team_uuid: TEAM_UUID, realm },
    JWT_SECRET,
    3600,
    JWT_KID ? { kid: JWT_KID } : {},
  );
  const traceUuid = randomSessionId();
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
