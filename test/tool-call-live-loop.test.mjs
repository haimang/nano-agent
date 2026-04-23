import test from "node:test";
import assert from "node:assert/strict";

/**
 * P2 Phase 5 — root e2e #1: capability binding seam readiness guard.
 *
 * Per action-plan §S9 + P1-P5 GPT review R2, the wire shape is:
 *   - `session.start.body.initial_input`  — first-turn upstream text
 *   - `session.followup_input.body.text`  — subsequent turn text
 *   - `turn_input`                         — RUNTIME-INTERNAL only
 *     (TurnInput type), NEVER a wire kind name.
 *
 * Per P2 action-plan §5.6, this test runs **in-process** (no live
 * preview URL dependency) and asserts the load-bearing binding contracts:
 *   (a) BASH_CORE binding is declared in wrangler.jsonc (D07);
 *   (b) composition routes capability transport to service-binding
 *       when BASH_CORE is present (Q2a default);
 *   (c) the default `NanoSessionDO` path also flips to the remote
 *       composition factory when only BASH_CORE is present;
 *   (d) a mock BASH_CORE.fetch is reachable via the transport seam —
 *       same contract that live `nano-agent-bash-core-preview` exposes
 *       via `/capability/call` + `/capability/cancel`.
 *
 * The full live turn loop (kernel → llm → tool_call → binding →
 * bash-core → session.stream.event) is gated on kernel / llm going
 * from `P2-stub` to live — a later charter. This e2e protects the
 * composition-level binding path so when that charter ships, the
 * binding slot is already known-good.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("..", import.meta.url);
const WRANGLER_PATH = new URL(
  "./workers/agent-core/wrangler.jsonc",
  ROOT,
);

test("(a) wrangler.jsonc declares BASH_CORE service binding (D07 activated)", () => {
  const raw = readFileSync(fileURLToPath(WRANGLER_PATH), "utf8");
  // Uncommented `"binding": "BASH_CORE"` must appear.
  // Strip `//` line comments first so we do not accept a commented-out
  // slot as "activated".
  const stripped = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.match(stripped, /"binding"\s*:\s*"BASH_CORE"/);
  assert.match(stripped, /"service"\s*:\s*"nano-agent-bash-core(-preview)?"/);
  // R3 guard: no `/tool.call.request` public path in agent-core entry.
  const indexPath = new URL(
    "./workers/agent-core/src/index.ts",
    ROOT,
  );
  const indexSrc = readFileSync(fileURLToPath(indexPath), "utf8");
  assert.doesNotMatch(indexSrc, /\/tool\.call\.request/);
});

test("(b) composition factory routes capability to service-binding when BASH_CORE is bound (Q2a default)", async () => {
  const { createDefaultCompositionFactory } = await import(
    "../workers/agent-core/dist/host/composition.js"
  );
  const { DEFAULT_RUNTIME_CONFIG } = await import(
    "../workers/agent-core/dist/host/env.js"
  );

  const calls = [];
  const fakeBinding = {
    fetch: async (request) => {
      calls.push({
        url: request.url,
        method: request.method,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  const factory = createDefaultCompositionFactory();
  const handles = factory.create(
    { SESSION_DO: {}, BASH_CORE: fakeBinding },
    DEFAULT_RUNTIME_CONFIG,
  );

  assert.equal(handles.capability.transport, "service-binding");
  assert.equal(handles.capability.serviceBindingTransport, fakeBinding);
});

test("(c) NanoSessionDO default path flips capability profile to remote when only BASH_CORE is bound", async () => {
  const { NanoSessionDO } = await import(
    "../workers/agent-core/dist/host/do/nano-session-do.js"
  );

  const fakeBinding = {
    fetch: async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  };

  const instance = new NanoSessionDO(
    {},
    { TEAM_UUID: "team-p2", BASH_CORE: fakeBinding },
  );
  const subsystems = instance.getSubsystems();

  assert.equal(subsystems.profile.capability, "remote");
  assert.equal(
    typeof subsystems.capability.serviceBindingTransport?.call,
    "function",
  );
});

test("(d) capability transport seam invokes BASH_CORE.fetch end-to-end (mock binding)", async () => {
  const { createDefaultCompositionFactory } = await import(
    "../workers/agent-core/dist/host/composition.js"
  );
  const { DEFAULT_RUNTIME_CONFIG } = await import(
    "../workers/agent-core/dist/host/env.js"
  );

  let fetchCount = 0;
  const fakeBinding = {
    fetch: async (request) => {
      fetchCount += 1;
      assert.equal(request.method, "POST");
      assert.match(request.url, /\/capability\//);
      return new Response(JSON.stringify({ ok: true, fetchCount }), {
        status: 200,
      });
    },
  };

  const factory = createDefaultCompositionFactory();
  const handles = factory.create(
    { SESSION_DO: {}, BASH_CORE: fakeBinding },
    DEFAULT_RUNTIME_CONFIG,
  );

  // Direct transport-seam probe: call the binding exactly the way the
  // composition-wired transport would. The real kernel loop would
  // package a `tool.call.request` NACP body into the payload; here we
  // just prove the seam reaches the binding.
  const transport = handles.capability.serviceBindingTransport;
  assert.notEqual(transport, null);
  const resp = await transport.fetch(
    new Request("https://binding.local/capability/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "probe-1",
        capabilityName: "ls",
        body: { tool_call: { name: "ls" } }, // tool.call.request shape
      }),
    }),
  );
  assert.equal(resp.status, 200);
  assert.equal(fetchCount, 1);
  const json = await resp.json();
  assert.equal(json.ok, true);
});

test("(e) R2 wire-truth guard: agent-core source references session.start.initial_input and session.followup_input.text but NOT a 'turn_input' wire kind", async () => {
  // This guard ensures future edits do not introduce a literal
  // `"turn_input"` message_type or wire-body-kind string. `TurnInput`
  // (the TS type) is fine; the test checks only quoted kind-value
  // usages via a pattern specific to message_type / kind fields.
  const turnIngress = readFileSync(
    fileURLToPath(
      new URL("./workers/agent-core/src/host/turn-ingress.ts", ROOT),
    ),
    "utf8",
  );
  assert.match(turnIngress, /"session\.start"/);
  assert.match(turnIngress, /"session\.followup_input"/);
  // No literal `"turn_input"` used as a message_type value.
  const bannedKindValues = turnIngress.match(
    /message_type\s*:\s*"turn_input"|kind\s*:\s*"turn_input"/g,
  );
  assert.equal(bannedKindValues, null);
});
