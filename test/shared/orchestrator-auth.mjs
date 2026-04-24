import assert from "node:assert/strict";
import { randomSessionId } from "./live.mjs";
import { signOrchestratorJwt } from "./orchestrator-jwt.mjs";

const JWT_SECRET = process.env.NANO_AGENT_ORCHESTRATOR_JWT_SECRET;

export async function createOrchestratorAuth(realm = "live-e2e") {
  assert.ok(JWT_SECRET, "set NANO_AGENT_ORCHESTRATOR_JWT_SECRET for orchestrator live tests");
  const token = await signOrchestratorJwt({ sub: randomSessionId(), realm }, JWT_SECRET);
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
