import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../shared/live.mjs";
import { createOrchestratorAuth } from "../shared/orchestrator-auth.mjs";

const VISIBILITY_THRESHOLD_MS = 5_000;

function isoNow() {
  return new Date().toISOString();
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket open timeout")), 5_000);
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

function waitForAnyMessage(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket initial message timeout")), 10_000);
    ws.addEventListener("message", (event) => {
      let parsed;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      clearTimeout(timer);
      resolve(parsed);
    }, { once: true });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(event.error ?? new Error("websocket error"));
    }, { once: true });
  });
}

function waitForRuntimeUpdate(ws, sessionId, expectedVersion, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("session.runtime.update websocket timeout")), 10_000);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("session.runtime.update wait aborted"));
    }, { once: true });
    ws.addEventListener("message", (event) => {
      let parsed;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (
        parsed?.kind === "session.runtime.update" &&
        parsed.session_uuid === sessionId &&
        parsed.version === expectedVersion
      ) {
        clearTimeout(timer);
        resolve(parsed);
      }
    });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(event.error ?? new Error("websocket error"));
    }, { once: true });
  });
}

function buildEvidence({
  traceUuid,
  startMs,
  startTs,
  firstVisibleMs,
  firstVisibleTs,
  terminalMs,
  terminalTs,
  version,
}) {
  const firstVisibleLatencyMs = firstVisibleMs - startMs;
  const terminalLatencyMs = terminalMs - startMs;
  return {
    phase: "PP0",
    scenario: "runtime-control-baseline",
    transport: ["HTTP", "WS"],
    trace_uuid: traceUuid,
    start_ts: startTs,
    first_visible_ts: firstVisibleTs,
    terminal_or_degraded_ts: terminalTs,
    verdict: "live",
    runtime_version: version,
    coverage: {
      http_control_path: "PATCH /sessions/{id}/runtime",
      ws_event_path: "session.runtime.update",
      durable_read_model: "GET /sessions/{id}/runtime",
      pending_extensions: [
        "pending-PP1-hitl",
        "pending-PP2-context-budget",
        "pending-PP3-reconnect",
        "pending-PP4-hook",
      ],
    },
    latency_ms: {
      first_visible: firstVisibleLatencyMs,
      terminal_or_degraded: terminalLatencyMs,
    },
    latency_alert: {
      threshold_key: "pp0-runtime-baseline-visible-ms",
      threshold_ms: VISIBILITY_THRESHOLD_MS,
      exceeded_count: firstVisibleLatencyMs > VISIBILITY_THRESHOLD_MS ? 1 : 0,
      accepted_by_owner: false,
      repro_condition:
        "NANO_AGENT_LIVE_E2E=1 pnpm test:cross-e2e -- test/cross-e2e/16-pro-to-product-baseline-skeleton.test.mjs",
    },
  };
}

liveTest(
  "PP0 baseline skeleton — runtime PATCH emits WS event and durable read-model truth",
  ["orchestrator-core"],
  async ({ getUrl }) => {
    const base = getUrl("orchestrator-core");
    const wsBase = base.replace(/^http/, "ws");
    const { token, traceUuid, authHeaders, jsonHeaders } = await createOrchestratorAuth("cross-e2e-pp0");

    const minted = await fetchJson(`${base}/me/sessions`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(minted.response.status, 201, `POST /me/sessions failed: ${minted.text}`);
    assert.equal(minted.json?.ok, true);
    assert.equal(typeof minted.json?.data?.session_uuid, "string");
    assert.equal(typeof minted.json?.data?.start_url, "string");

    const sessionId = minted.json.data.session_uuid;
    const start = await fetchJson(`${base}${minted.json.data.start_url}`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ initial_input: "pp0-runtime-baseline" }),
    });
    assert.equal(start.response.status, 200, `POST ${minted.json.data.start_url} failed: ${start.text}`);
    assert.equal(start.json?.ok, true);

    const before = await fetchJson(`${base}/sessions/${sessionId}/runtime`, { headers: authHeaders });
    assert.equal(before.response.status, 200, `GET /runtime before patch failed: ${before.text}`);
    assert.equal(before.json?.ok, true);
    assert.equal(before.json?.data?.session_uuid, sessionId);
    assert.equal(typeof before.json?.data?.version, "number");
    const etag = before.response.headers.get("etag");
    assert.equal(typeof etag, "string");

    const ws = new WebSocket(`${wsBase}/sessions/${sessionId}/ws?access_token=${token}&trace_uuid=${traceUuid}`);
    try {
      await waitForOpen(ws);
      await waitForAnyMessage(ws);

      const startMs = Date.now();
      const startTs = isoNow();
      const expectedVersion = before.json.data.version + 1;
      const runtimeUpdateAbort = new AbortController();
      const runtimeUpdatePromise = waitForRuntimeUpdate(ws, sessionId, expectedVersion, runtimeUpdateAbort.signal);
      const patch = await fetchJson(`${base}/sessions/${sessionId}/runtime`, {
        method: "PATCH",
        headers: { ...jsonHeaders, "if-match": etag },
        body: JSON.stringify({
          version: before.json.data.version,
          approval_policy: "always_allow",
        }),
      });
      if (patch.response.status !== 200) {
        runtimeUpdateAbort.abort(new Error("PATCH /runtime failed before runtime update was expected"));
        await runtimeUpdatePromise.catch(() => null);
      }
      assert.equal(patch.response.status, 200, `PATCH /runtime failed: ${patch.text}`);
      assert.equal(patch.json?.ok, true);
      assert.equal(patch.json?.data?.approval_policy, "always_allow");
      assert.equal(patch.json?.data?.version, expectedVersion);

      const runtimeUpdate = await runtimeUpdatePromise;
      const firstVisibleMs = Date.now();
      const firstVisibleTs = isoNow();
      assert.equal(runtimeUpdate.approval_policy, "always_allow");

      const after = await fetchJson(`${base}/sessions/${sessionId}/runtime`, { headers: authHeaders });
      const terminalMs = Date.now();
      const terminalTs = isoNow();
      assert.equal(after.response.status, 200, `GET /runtime after patch failed: ${after.text}`);
      assert.equal(after.json?.ok, true);
      assert.equal(after.json?.data?.approval_policy, "always_allow");
      assert.equal(after.json?.data?.version, patch.json.data.version);

      const evidence = buildEvidence({
        traceUuid,
        startMs,
        startTs,
        firstVisibleMs,
        firstVisibleTs,
        terminalMs,
        terminalTs,
        version: after.json.data.version,
      });
      assert.equal(evidence.verdict, "live");
      assert.equal(evidence.coverage.http_control_path, "PATCH /sessions/{id}/runtime");
      assert.equal(evidence.coverage.ws_event_path, "session.runtime.update");
      assert.equal(evidence.coverage.durable_read_model, "GET /sessions/{id}/runtime");
      console.log(`PP0_EVIDENCE ${JSON.stringify(evidence)}`);
    } finally {
      ws.close();
    }
  },
);
