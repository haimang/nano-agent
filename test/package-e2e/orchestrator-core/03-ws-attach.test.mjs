import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../../shared/live.mjs";
import { createOrchestratorAuth } from "../../shared/orchestrator-auth.mjs";

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
  const base = getUrl("orchestrator-core");
  const wsBase = base.replace(/^http/, "ws");
  const sessionId = randomSessionId();
  const { token, traceUuid, jsonHeaders } = await createOrchestratorAuth("package-e2e");

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ initial_input: "ws-attach-test" }),
  });
  assert.equal(start.response.status, 200);

  const ws1 = new WebSocket(`${wsBase}/sessions/${sessionId}/ws?access_token=${token}&trace_uuid=${traceUuid}`);
  await waitForOpen(ws1);

  const ws2 = new WebSocket(`${wsBase}/sessions/${sessionId}/ws?access_token=${token}&trace_uuid=${traceUuid}`);
  const supersededPromise = waitForMatchingMessage(ws1, (message) => (
    message.kind === "attachment_superseded" ||
    message.kind === "session.attachment.superseded"
  ));
  await waitForOpen(ws2);

  const superseded = await supersededPromise;
  assert.ok(
    superseded.kind === "attachment_superseded" ||
    superseded.kind === "session.attachment.superseded",
  );
  assert.ok(
    superseded.reason === "replaced_by_new_attachment" ||
    superseded.reason === "reattach",
  );

  ws1.close();
  ws2.close();
});
