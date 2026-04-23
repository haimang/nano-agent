import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../../shared/live.mjs";

/**
 * Package e2e — agent-core /verify route's honest-error envelope.
 *
 * /verify exposes a finite set of named e2e harness checks
 * (capability-call / capability-cancel / initial-context /
 * compact-posture / filesystem-posture). Anything else must return a
 * structured "unknown-verify-check" envelope that enumerates the
 * supported set — this is a contract used by *this* test tree to
 * discover drift if new checks get added / removed without updating
 * the e2e layer.
 *
 * Locks:
 *   (a) unknown check name → HTTP 200 + body
 *       `{ok:true, action:"verify", check:"<input>",
 *         error:"unknown-verify-check", supported:[<names>]}`
 *   (b) missing `check` field → same envelope with `check:""`
 *   (c) supported set is a non-empty array of strings and contains the
 *       5 checks currently wired (drift guard — if a check is renamed
 *       this test will red, forcing INDEX.md update)
 */

const EXPECTED_SUPPORTED_CHECKS = [
  "capability-call",
  "capability-cancel",
  "initial-context",
  "compact-posture",
  "filesystem-posture",
];

liveTest(
  "agent-core /verify returns canonical unknown-verify-check envelope on bogus check",
  ["agent-core"],
  async ({ getUrl }) => {
    const base = getUrl("agent-core");

    const res = await fetchJson(
      `${base}/sessions/${randomSessionId()}/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ check: "definitely-not-a-real-check" }),
      },
    );

    assert.equal(res.response.status, 200);
    assert.equal(res.json?.ok, true);
    assert.equal(res.json?.action, "verify");
    assert.equal(res.json?.check, "definitely-not-a-real-check");
    assert.equal(res.json?.error, "unknown-verify-check");
    assert.ok(Array.isArray(res.json?.supported));
    assert.ok(res.json.supported.length >= 1);
    for (const name of EXPECTED_SUPPORTED_CHECKS) {
      assert.ok(
        res.json.supported.includes(name),
        `expected supported list to include ${name}; got ${JSON.stringify(res.json.supported)}`,
      );
    }
  },
);

liveTest(
  "agent-core /verify treats missing check field as unknown-verify-check",
  ["agent-core"],
  async ({ getUrl }) => {
    const base = getUrl("agent-core");

    const res = await fetchJson(
      `${base}/sessions/${randomSessionId()}/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );

    assert.equal(res.response.status, 200);
    assert.equal(res.json?.ok, true);
    assert.equal(res.json?.action, "verify");
    assert.equal(res.json?.check, "");
    assert.equal(res.json?.error, "unknown-verify-check");
    assert.ok(Array.isArray(res.json?.supported));
  },
);
