import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../shared/live.mjs";
import { createOrchestratorAuth } from "../shared/orchestrator-auth.mjs";

/**
 * Cross e2e — end-to-end session lifecycle through agent-core's full
 * host loop with BASH_CORE binding active.
 *
 * Unlike package-e2e/agent-core/04-session-lifecycle which runs
 * lifecycle probes in isolation, this test walks through the complete
 * client-perceived sequence and asserts that cross-worker state
 * (BASH_CORE binding / capability call reach) stays consistent
 * across the lifecycle:
 *
 *   start(initial_input)
 *     → input(followup)           # session.followup_input wire
 *     → verify(capability-call)   # agent→bash cross-seam still works
 *                                 # mid-session, not just right after start
 *     → cancel                    # terminate active turn
 *     → status                    # post-cancel status reachable
 *     → timeline                  # post-cancel timeline reachable
 *
 * A red here means one of:
 *   - session state drifted after cancel and capability cross-seam broke
 *   - followup_input wire path corrupts subsequent verify-call
 *   - bash-core binding is tied to a specific turn and doesn't survive
 *     the turn lifecycle(it should — binding is DO-level, not turn-level)
 */

liveTest(
  "orchestrator-core + bash-core — full session lifecycle with mid-session cross-worker call",
  ["orchestrator-core", "bash-core"],
  async ({ getUrl }) => {
    const base = getUrl("orchestrator-core");
    const sessionId = randomSessionId();
    const { authHeaders, jsonHeaders } = await createOrchestratorAuth("cross-e2e");

    const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ initial_input: "lifecycle-xwkr-t1" }),
    });
    assert.equal(start.response.status, 200);
    assert.equal(start.json?.action, "start");

    const input = await fetchJson(`${base}/sessions/${sessionId}/input`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ text: "lifecycle-xwkr-t2" }),
    });
    assert.equal(input.response.status, 200);
    assert.equal(input.json?.ok, true);

    // Mid-session cross-seam probe: still reaches bash-core
    const verify = await fetchJson(`${base}/sessions/${sessionId}/verify`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        check: "capability-call",
        toolName: "pwd",
        toolInput: {},
      }),
    });
    assert.equal(verify.response.status, 200);
    assert.equal(verify.json?.response?.status, "ok");

    const cancel = await fetchJson(`${base}/sessions/${sessionId}/cancel`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(cancel.response.status, 200);
    assert.equal(cancel.json?.terminal, "cancelled");

    const status = await fetchJson(`${base}/sessions/${sessionId}/status`, { headers: authHeaders });
    assert.equal(status.response.status, 200);
    assert.equal(status.json?.ok, true);

    const timeline = await fetchJson(`${base}/sessions/${sessionId}/timeline`, { headers: authHeaders });
    assert.equal(timeline.response.status, 200);
    assert.ok(Array.isArray(timeline.json?.events));
  },
);
