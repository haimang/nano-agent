import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../../shared/live.mjs";

/**
 * Package e2e — bash-core 21-command registry sampling.
 *
 * Rather than running all 21 commands(most need real inputs or are
 * gated by policy-ask), we sample the two that execute cleanly with
 * empty `tool_input` and return structured ok + output:
 *   - `pwd` — reads DEFAULT_WORKSPACE_ROOT
 *   - `ls`  — lists namespace entries (empty workspace → empty list)
 *
 * These two are the **happy-path readers** in the absorbed
 * capability-runtime and cover:
 *   - registry lookup from `registerMinimalCommands`
 *   - policy gate (both are `allow` policy)
 *   - executor → LocalTsTarget → handler → result
 *   - `{status:"ok", output:<string>}` canonical envelope
 *
 * A red here means the deploy artifact's capability registry drifted
 * away from the absorbed `MINIMAL_COMMANDS` list or the executor lost
 * one of the foundational handlers.
 */

const SAMPLES = [
  { name: "pwd", desc: "prints workspace root" },
  { name: "ls", desc: "lists workspace entries" },
];

for (const { name, desc } of SAMPLES) {
  liveTest(
    `bash-core capability "${name}" (${desc}) returns canonical ok envelope`,
    ["bash-core"],
    async ({ getUrl }) => {
      const res = await fetchJson(`${getUrl("bash-core")}/capability/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: `live-sample-${name}-${crypto.randomUUID()}`,
          capabilityName: name,
          body: { tool_name: name, tool_input: {} },
        }),
      });

      assert.equal(res.response.status, 200);
      assert.equal(res.json?.status, "ok");
      assert.equal(
        typeof res.json?.output,
        "string",
        `${name} should return string output`,
      );
    },
  );
}
