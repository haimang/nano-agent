import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../../shared/live.mjs";
import { signOrchestratorJwt } from "../../shared/orchestrator-jwt.mjs";

const JWT_SECRET = process.env.NANO_AGENT_ORCHESTRATOR_JWT_SECRET;

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
}

function waitForMatchingMessage(ws, match, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for matching websocket message")), timeout);
    const onMessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (!match(parsed)) return;
        clearTimeout(timer);
        ws.removeEventListener?.("message", onMessage);
        resolve(parsed);
      } catch {
        // Ignore non-JSON messages and keep listening.
      }
    };
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", (event) => { clearTimeout(timer); reject(event); }, { once: true });
  });
}

liveTest("orchestrator-core ws attach upgrades and emits superseded signal on replacement", ["orchestrator-core"], async ({ getUrl }) => {
  assert.ok(JWT_SECRET, "set NANO_AGENT_ORCHESTRATOR_JWT_SECRET for orchestrator live tests");
  const base = getUrl("orchestrator-core");
  const wsBase = base.replace(/^http/, "ws");
  const sessionId = randomSessionId();
  const token = await signOrchestratorJwt({ sub: randomSessionId(), realm: "package-e2e" }, JWT_SECRET);

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ initial_input: "ws-attach-test" }),
  });
  assert.equal(start.response.status, 200);

  const ws1 = new WebSocket(`${wsBase}/sessions/${sessionId}/ws?access_token=${token}`);
  await waitForOpen(ws1);

  const ws2 = new WebSocket(`${wsBase}/sessions/${sessionId}/ws?access_token=${token}`);
  const supersededPromise = waitForMatchingMessage(ws1, (message) => message.kind === "attachment_superseded");
  await waitForOpen(ws2);

  const superseded = await supersededPromise;
  assert.equal(superseded.kind, "attachment_superseded");
  assert.equal(superseded.reason, "replaced_by_new_attachment");

  ws1.close();
  ws2.close();
});
