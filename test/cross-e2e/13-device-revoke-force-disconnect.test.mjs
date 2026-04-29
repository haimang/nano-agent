import assert from "node:assert/strict";
import crypto from "node:crypto";
import { fetchJson, liveTest, randomSessionId } from "../shared/live.mjs";
import { loginOrchestratorAccount, registerOrchestratorAccount } from "../shared/orchestrator-auth.mjs";

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket open timeout")), 10_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(event.error ?? new Error("websocket error"));
    }, { once: true });
  });
}

function waitForMatchingMessage(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket message timeout")), 10_000);
    ws.addEventListener("message", (event) => {
      let parsed;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!predicate(parsed)) return;
      clearTimeout(timer);
      resolve(parsed);
    });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(event.error ?? new Error("websocket error"));
    }, { once: true });
  });
}

function waitForClose(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket close timeout")), 10_000);
    ws.addEventListener("close", (event) => {
      clearTimeout(timer);
      resolve({ code: event.code, reason: event.reason });
    }, { once: true });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(event.error ?? new Error("websocket error"));
    }, { once: true });
  });
}

liveTest(
  "RH3 device revoke closes attached websocket and invalidates old access token",
  ["orchestrator-core"],
  async ({ getUrl }) => {
    const base = getUrl("orchestrator-core");
    const wsBase = base.replace(/^http/, "ws");
    const device1 = crypto.randomUUID();
    const device2 = crypto.randomUUID();
    const sessionId = randomSessionId();

    const primary = await registerOrchestratorAccount({
      realm: "cross-e2e-device-revoke",
      deviceUuid: device1,
      deviceLabel: "cross-e2e-laptop",
      deviceKind: "web",
    });

    const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
      method: "POST",
      headers: primary.jsonHeaders,
      body: JSON.stringify({ initial_input: "device-revoke-smoke" }),
    });
    assert.equal(start.response.status, 200);
    assert.equal(start.json?.ok, true);

    const ws = new WebSocket(`${wsBase}/sessions/${sessionId}/ws?access_token=${primary.token}&trace_uuid=${primary.traceUuid}`);
    await waitForOpen(ws);
    await waitForMatchingMessage(
      ws,
      (message) => message.kind === "event" || message.kind === "meta",
    );

    const secondary = await loginOrchestratorAccount({
      realm: "cross-e2e-device-revoke",
      email: primary.email,
      password: primary.password,
      deviceUuid: device2,
      deviceLabel: "cross-e2e-phone",
      deviceKind: "mobile",
    });

    const revoke = await fetchJson(`${base}/me/devices/revoke`, {
      method: "POST",
      headers: secondary.jsonHeaders,
      body: JSON.stringify({ device_uuid: primary.deviceUuid, reason: "cross-e2e-revoke" }),
    });
    assert.equal(revoke.response.status, 200);
    assert.equal(revoke.json?.ok, true);
    assert.equal(revoke.json?.data?.device_uuid, primary.deviceUuid);
    assert.equal(revoke.json?.data?.status, "revoked");

    const closed = await waitForClose(ws);
    assert.equal(closed.code, 4001);

    const oldAccess = await fetchJson(`${base}/me/team`, {
      headers: {
        authorization: `Bearer ${primary.token}`,
        "x-trace-uuid": crypto.randomUUID(),
      },
    });
    assert.equal(oldAccess.response.status, 401);
    assert.equal(oldAccess.json?.error?.code, "invalid-auth");
  },
);
