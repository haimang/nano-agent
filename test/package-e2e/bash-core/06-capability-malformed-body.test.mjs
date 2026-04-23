import assert from "node:assert/strict";
import { liveTest } from "../../shared/live.mjs";

/**
 * Package e2e — bash-core input validation at the HTTP boundary.
 *
 * Before any capability runtime dispatch happens, `workers/bash-core/
 * src/index.ts` must reject malformed input with:
 *   - HTTP 400 (not 500, not 200)
 *   - body shape `{error:<kind>, message:<string>, worker:"bash-core",
 *     phase:"worker-matrix-P1.B-absorbed"}`
 *
 * We probe the two boundary kinds:
 *   - `invalid-json` — body is not JSON
 *   - `invalid-request-shape` — JSON but not `{requestId, body:
 *     {tool_name, tool_input}}`
 *
 * These two error kinds are worker-HTTP-layer validation (not
 * capability-runtime layer); they must carry the worker + phase
 * fields so that upstream observability can attribute them to the
 * bash-core deploy artifact.
 */

async function rawPost(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { response, json };
}

liveTest(
  "bash-core /capability/call rejects non-JSON body with invalid-json envelope",
  ["bash-core"],
  async ({ getUrl }) => {
    const res = await rawPost(`${getUrl("bash-core")}/capability/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "this-is-not-json",
    });

    assert.equal(res.response.status, 400);
    assert.equal(res.json?.error, "invalid-json");
    assert.equal(res.json?.worker, "bash-core");
    assert.equal(res.json?.phase, "worker-matrix-P1.B-absorbed");
    assert.equal(typeof res.json?.message, "string");
  },
);

liveTest(
  "bash-core /capability/call rejects missing tool_name with invalid-request-shape envelope",
  ["bash-core"],
  async ({ getUrl }) => {
    const res = await rawPost(`${getUrl("bash-core")}/capability/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "missing-tool-name", body: {} }),
    });

    assert.equal(res.response.status, 400);
    assert.equal(res.json?.error, "invalid-request-shape");
    assert.equal(res.json?.worker, "bash-core");
    assert.equal(res.json?.phase, "worker-matrix-P1.B-absorbed");
    assert.match(res.json?.message, /tool_name/);
  },
);

liveTest(
  "bash-core /capability/call rejects empty body with invalid-request-shape envelope",
  ["bash-core"],
  async ({ getUrl }) => {
    const res = await rawPost(`${getUrl("bash-core")}/capability/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(res.response.status, 400);
    assert.equal(res.json?.error, "invalid-request-shape");
  },
);
