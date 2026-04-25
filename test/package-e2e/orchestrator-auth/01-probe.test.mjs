import assert from "node:assert/strict";
import { expectProbe, fetchJson, liveTest } from "../../shared/live.mjs";

liveTest("orchestrator-auth exposes only probe surface publicly", ["orchestrator-auth"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-auth");

  const probe = await fetchJson(base);
  assert.equal(probe.response.status, 200);
  expectProbe(probe.json, {
    worker: "orchestrator-auth",
    status: "ok",
    public_business_routes: false,
    rpc_surface: true,
  });

  const publicRoute = await fetchJson(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "user@example.com", password: "password-123" }),
  });
  assert.equal(publicRoute.response.status, 404);
  assert.equal(publicRoute.json?.error, "not-found");
});
