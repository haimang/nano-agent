import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../shared/live.mjs";

/**
 * Cross e2e — bash-core error envelopes propagate through agent-core
 * binding without mutation or re-wrapping.
 *
 * When agent-core's verify route calls bash-core via `BASH_CORE`
 * service binding, the canonical `{status:"error", error:{code,
 * message}}` envelope must reach the client verbatim under
 * `response.<field>`. This guards against:
 *   - agent-core silently swallowing bash-core errors
 *   - agent-core re-wrapping bash errors into its own taxonomy (R2
 *     forbidden — canonical error shape must survive the cross-seam)
 *   - Envelope shape drift between `/capability/call` direct probe
 *     and agent-core's `/verify` indirect probe
 *
 * Covers the same 2 error codes as package-e2e/bash-core/05 but
 * through the cross-worker path:
 *   - `unknown-tool` (tool absent from registry)
 *   - `policy-ask`   (ask-gated capability, no authorizer)
 */

const CROSS_CASES = [
  {
    label: "unknown-tool",
    toolName: "echo", // absent from MINIMAL_COMMANDS
    expectedCode: "unknown-tool",
  },
  {
    label: "policy-ask",
    toolName: "curl", // ask policy, no authorizer
    expectedCode: "policy-ask",
  },
];

for (const { label, toolName, expectedCode } of CROSS_CASES) {
  liveTest(
    `agent-core verify surfaces bash-core "${expectedCode}" error verbatim (${label})`,
    ["agent-core", "bash-core"],
    async ({ getUrl }) => {
      const verify = await fetchJson(
        `${getUrl("agent-core")}/sessions/${randomSessionId()}/verify`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            check: "capability-call",
            toolName,
            toolInput: {},
          }),
        },
      );

      assert.equal(verify.response.status, 200);
      assert.equal(verify.json?.ok, true);
      assert.equal(verify.json?.check, "capability-call");
      assert.equal(verify.json?.toolName, toolName);

      // Inner canonical envelope: not re-wrapped, not mutated
      assert.equal(
        verify.json?.response?.status,
        "error",
        `expected bash-core error surfaced under response.status`,
      );
      assert.equal(
        verify.json?.response?.error?.code,
        expectedCode,
        `expected canonical error code ${expectedCode} from bash-core; got ${JSON.stringify(verify.json?.response)}`,
      );
      assert.equal(typeof verify.json?.response?.error?.message, "string");

      // R2 invariant: no invented error kind (agent-core must NOT
      // emit system.error wrapping the bash error)
      assert.notEqual(verify.json?.response?.kind, "system.error");
    },
  );
}
