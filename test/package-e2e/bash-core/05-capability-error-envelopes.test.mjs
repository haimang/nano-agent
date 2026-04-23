import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../../shared/live.mjs";

/**
 * Package e2e — bash-core canonical error envelope taxonomy.
 *
 * Every non-ok capability call must return
 *   `{status:"error", error:{code:<string>, message:<string>}}`
 * and NEVER leak raw exception text or different shape. This test
 * covers the 3 primary error codes:
 *
 *   - `unknown-tool`  — capability name not in registry
 *     (e.g. `echo` is absent from the current 21-command minimal set;
 *     chosen as a stable drift probe)
 *   - `policy-ask`   — command policy is `ask`, no authorizer wired in
 *     the preview deploy → must fail-closed with policy-ask error
 *     (e.g. `curl`, `ts-exec`)
 *   - `handler-error` — valid command + policy allow, but handler
 *     throws due to missing required `tool_input` fields
 *     (e.g. `cat` with empty input)
 *
 * Red here → canonical envelope drift in `workers/bash-core/src/
 * worker-runtime.ts` or upstream executor / policy gate;
 * downstream R2 error-kind guard (no `system.error` invention) may
 * also regress if this drifts.
 */

const CASES = [
  {
    label: "unknown-tool",
    code: "unknown-tool",
    tool_name: "echo", // absent from MINIMAL_COMMANDS
    tool_input: {},
  },
  {
    label: "policy-ask",
    code: "policy-ask",
    tool_name: "curl",
    tool_input: {},
  },
  {
    label: "handler-error",
    code: "handler-error",
    tool_name: "cat", // registered + allow policy, but empty input throws
    tool_input: {},
  },
];

for (const { label, code, tool_name, tool_input } of CASES) {
  liveTest(
    `bash-core /capability/call emits canonical "${code}" error envelope (${label})`,
    ["bash-core"],
    async ({ getUrl }) => {
      const res = await fetchJson(`${getUrl("bash-core")}/capability/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: `err-${label}-${crypto.randomUUID()}`,
          capabilityName: tool_name,
          body: { tool_name, tool_input },
        }),
      });

      assert.equal(res.response.status, 200);
      assert.equal(res.json?.status, "error");
      assert.equal(
        res.json?.error?.code,
        code,
        `expected error code ${code}; got ${JSON.stringify(res.json)}`,
      );
      assert.equal(typeof res.json?.error?.message, "string");
      assert.ok(res.json.error.message.length > 0);
    },
  );
}
