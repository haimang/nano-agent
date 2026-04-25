import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../../shared/live.mjs";
import { signOrchestratorJwt } from "../../shared/orchestrator-jwt.mjs";

const JWT_KID = process.env.NANO_AGENT_ORCHESTRATOR_JWT_KID ?? process.env.JWT_SIGNING_KID ?? "v1";
const JWT_SECRET =
  process.env.NANO_AGENT_ORCHESTRATOR_JWT_SECRET ??
  process.env[`JWT_SIGNING_KEY_${JWT_KID}`] ??
  process.env.JWT_SIGNING_KEY_v1;

liveTest("orchestrator-core rejects missing bearer token on public start", ["orchestrator-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const sessionId = randomSessionId();

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initial_input: "missing-auth" }),
  });

  assert.equal(start.response.status, 401);
  assert.equal(start.json?.error, "invalid-auth");
  assert.equal(start.json?.message, "missing bearer token");
});

liveTest("orchestrator-core rejects malformed bearer token on public start", ["orchestrator-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const sessionId = randomSessionId();

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: {
      authorization: "Bearer not-a-jwt",
      "content-type": "application/json",
    },
    body: JSON.stringify({ initial_input: "bad-auth" }),
  });

  assert.equal(start.response.status, 401);
  assert.equal(start.json?.error, "invalid-auth");
  assert.equal(start.json?.message, "token missing, invalid, or expired");
});

liveTest("orchestrator-core rejects missing trace uuid on authenticated public start", ["orchestrator-core"], async ({ getUrl }) => {
  assert.ok(JWT_SECRET, "set NANO_AGENT_ORCHESTRATOR_JWT_SECRET for orchestrator live tests");
  const base = getUrl("orchestrator-core");
  const sessionId = randomSessionId();
  const token = await signOrchestratorJwt(
    { sub: randomSessionId(), realm: "package-e2e" },
    JWT_SECRET,
    3600,
    { kid: "v1" },
  );

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ initial_input: "missing-trace" }),
  });

  assert.equal(start.response.status, 400);
  assert.equal(start.json?.error, "invalid-trace");
});

liveTest("orchestrator-core rejects missing tenant claim on public start", ["orchestrator-core"], async ({ getUrl }) => {
  assert.ok(JWT_SECRET, "set NANO_AGENT_ORCHESTRATOR_JWT_SECRET for orchestrator live tests");
  const base = getUrl("orchestrator-core");
  const sessionId = randomSessionId();
  const token = await signOrchestratorJwt(
    { sub: randomSessionId(), realm: "package-e2e" },
    JWT_SECRET,
    3600,
    { kid: "v1" },
  );

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-trace-uuid": randomSessionId(),
    },
    body: JSON.stringify({ initial_input: "missing-tenant" }),
  });

  assert.equal(start.response.status, 403);
  assert.equal(start.json?.error, "missing-team-claim");
});
