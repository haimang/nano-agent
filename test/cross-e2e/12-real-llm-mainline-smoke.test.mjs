import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fetchJson, liveTest, randomSessionId } from "../shared/live.mjs";
import { createOrchestratorAuth } from "../shared/orchestrator-auth.mjs";

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

    const usage = queryD1(
      `SELECT COUNT(*) AS count FROM nano_usage_events WHERE session_uuid='${sessionId}' AND resource_kind='llm' AND verdict='allow' AND provider_key='workers-ai';`,
    );
    assert.ok(Number(usage[0]?.count) >= 1, "expected live Workers AI LLM usage evidence in preview D1");
  },
);
