import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fetchJson, liveTest, randomSessionId } from "../shared/live.mjs";
import { createOrchestratorAuth } from "../shared/orchestrator-auth.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function eventBody(event) {
  if (!event || typeof event !== "object") return null;
  if (event.kind && typeof event.kind === "string") return event;
  if (event.payload && typeof event.payload === "object") return event.payload;
  if (event.body && typeof event.body === "object") return event.body;
  return null;
}

async function waitForTimelineEvent(base, sessionId, headers, predicate) {
  let lastEvents = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const timeline = await fetchJson(`${base}/sessions/${sessionId}/timeline`, { headers });
    assert.equal(timeline.response.status, 200);
    lastEvents = Array.isArray(timeline.json?.events) ? timeline.json.events : [];
    const match = lastEvents.map(eventBody).find((body) => body && predicate(body));
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`timed out waiting for expected timeline event; observed=${JSON.stringify(lastEvents)}`);
}

function queryD1(sql) {
  const output = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "NANO_AGENT_DB",
      "--config",
      "workers/orchestrator-core/wrangler.jsonc",
      "--env",
      "preview",
      "--remote",
      "--json",
      "--command",
      sql,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  const jsonStart = output.indexOf("[");
  assert.ok(jsonStart >= 0, `wrangler did not return JSON output: ${output}`);
  const parsed = JSON.parse(output.slice(jsonStart));
  return Array.isArray(parsed?.[0]?.results) ? parsed[0].results : [];
}

function queryLlmUsageCount(sessionId) {
  assert.match(sessionId, UUID_RE);
  return queryD1(
    `SELECT COUNT(*) AS count FROM nano_usage_events WHERE session_uuid='${sessionId}' AND resource_kind='llm' AND verdict='allow' AND provider_key='workers-ai';`,
  );
}

function queryLlmUsageAnchor(sessionId) {
  assert.match(sessionId, UUID_RE);
  return queryD1(
    `SELECT usage_event_uuid, trace_uuid, session_uuid, idempotency_key, provider_key, resource_kind, verdict FROM nano_usage_events WHERE session_uuid='${sessionId}' AND resource_kind='llm' AND verdict='allow' AND provider_key='workers-ai' ORDER BY created_at DESC LIMIT 1;`,
  );
}

liveTest(
  "orchestrator-core starts a real Workers AI LLM mainline turn",
  ["orchestrator-core", "agent-core"],
  async ({ getUrl }) => {
    const base = getUrl("orchestrator-core");
    const sessionId = randomSessionId();
    const { authHeaders, jsonHeaders } = await createOrchestratorAuth("cross-e2e-real-llm");

    const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        initial_input: "Reply with one short sentence confirming the real LLM path is active.",
      }),
    });
    assert.equal(start.response.status, 200);

    const end = await waitForTimelineEvent(
      base,
      sessionId,
      authHeaders,
      (body) => body.kind === "turn.end",
    );
    assert.equal(end.kind, "turn.end");

    const usage = queryLlmUsageCount(sessionId);
    assert.ok(Number(usage[0]?.count) >= 1, "expected live Workers AI LLM usage evidence in preview D1");
    const [anchor] = queryLlmUsageAnchor(sessionId);
    assert.equal(anchor?.session_uuid, sessionId);
    console.log(
      `# Z4_LIVE_LLM_ANCHOR ${JSON.stringify({
        trace_uuid: anchor.trace_uuid,
        session_uuid: sessionId,
        usage_event_uuid: anchor.usage_event_uuid,
        idempotency_key: anchor.idempotency_key,
        provider_key: anchor.provider_key,
      })}`,
    );
  },
);
