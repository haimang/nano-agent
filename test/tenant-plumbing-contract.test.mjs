import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { NanoSessionDO } from "../packages/session-do-runtime/dist/do/nano-session-do.js";

// B9 root contract — session-do-runtime tenant plumbing materialization.
// See docs/rfc/nacp-core-1-3-draft.md §6 and
// docs/action-plan/after-foundations/B9-nacp-1-3-contract-freeze.md §4.4 P4-02.
//
// GPT-R3 integration: the original B9 draft used the grep pattern
// `state.storage.put|state.storage.get|state.storage.delete` which is a
// false-green — `NanoSessionDO` never used that exact pattern (the real
// pattern was `this.doState.storage.*`). This contract test replaces that
// assertion with a source-code white-list check: every raw
// `doState.storage.*` call site must live in a function whose identifier
// is on the allowed list.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const DO_SOURCE = join(
  REPO_ROOT,
  "packages/session-do-runtime/src/do/nano-session-do.ts",
);

const UUID = "11111111-1111-4111-8111-111111111111";
const TEAM_UUID = "team-b9-test";

function makeStorage() {
  const store = new Map();
  const state = {
    storage: {
      async get(k) {
        return store.get(k);
      },
      async put(k, v) {
        store.set(k, v);
      },
    },
  };
  return { state, store };
}

test("B9 P3-05 — DO ingress accepts legitimate session.start when env.TEAM_UUID is set", async () => {
  const { state } = makeStorage();
  const instance = new NanoSessionDO(state, { TEAM_UUID, SESSION_UUID: UUID });
  const frame = {
    header: {
      schema_version: "1.3.0",
      message_uuid: UUID,
      message_type: "session.start",
      delivery_kind: "command",
      sent_at: "2026-04-21T00:00:00.000+00:00",
      producer_role: "client",
      producer_key: "nano-agent.client.cli@v1",
      priority: "normal",
    },
    trace: { trace_uuid: UUID, session_uuid: UUID },
    body: { initial_input: "hi" },
  };
  await instance.webSocketMessage(null, JSON.stringify(frame));
  // No rejection recorded for a well-formed session.start.
  const rejection = instance.getLastIngressRejection();
  assert.equal(rejection, null);
});

test("B9-R1 fix — tenant violation blocks dispatch (not just logs rejection)", async () => {
  // Regression guard for the GPT-review B9-R1 blocker: a frame carrying
  // a `refs[*].team_uuid` that does not match `authority.team_uuid` MUST
  // be rejected by `acceptClientFrame()` AND MUST NOT reach
  // `dispatchAdmissibleFrame()`. Pre-fix, `verifyTenantBoundary()` was
  // fire-and-forget so dispatch ran synchronously before the violation
  // fired.
  const { state } = makeStorage();
  const instance = new NanoSessionDO(state, {
    TEAM_UUID,
    SESSION_UUID: UUID,
  });
  const badTeam = "team-attacker";
  const evilRef = {
    kind: "r2",
    binding: "R2_WORKSPACE",
    team_uuid: badTeam,
    key: `tenants/${badTeam}/sessions/${UUID}/attach/evil.json`,
    role: "input",
  };
  const frame = {
    header: {
      schema_version: "1.3.0",
      message_uuid: UUID,
      message_type: "session.start",
      delivery_kind: "command",
      sent_at: "2026-04-21T00:00:00.000+00:00",
      producer_role: "client",
      producer_key: "nano-agent.client.cli@v1",
      priority: "normal",
    },
    trace: { trace_uuid: UUID, session_uuid: UUID },
    body: { initial_input: "hi" },
    refs: [evilRef],
  };
  await instance.webSocketMessage(null, JSON.stringify(frame));

  // Rejection is recorded.
  const rej = instance.getLastIngressRejection();
  assert.ok(rej);
  assert.equal(rej.ok, false);
  assert.match(
    rej.message,
    /tenant boundary verification failed/,
    `expected boundary failure; got '${rej.message}'`,
  );

  // Dispatch did NOT happen — actor phase never advanced past `unattached`.
  const phase = instance.getState().actorState.phase;
  assert.equal(
    phase,
    "unattached",
    `dispatch should have been blocked; phase is '${phase}'`,
  );
});

test("B9 P3-06 — checkpoint + LAST_SEEN_SEQ writes land under tenants/<team>/ prefix", async () => {
  const { state, store } = makeStorage();
  const instance = new NanoSessionDO(state, { TEAM_UUID, SESSION_UUID: UUID });

  // Trigger a checkpoint persist via webSocketClose.
  await instance.webSocketClose(null);

  const checkpointKey = `tenants/${TEAM_UUID}/session:checkpoint`;
  assert.ok(
    store.has(checkpointKey),
    `expected checkpoint at '${checkpointKey}', got keys: ${[...store.keys()].join(", ")}`,
  );

  // Also test LAST_SEEN_SEQ path.
  const resumeFrame = {
    header: {
      schema_version: "1.3.0",
      message_uuid: UUID,
      message_type: "session.resume",
      delivery_kind: "command",
      sent_at: "2026-04-21T00:00:00.000+00:00",
      producer_role: "client",
      producer_key: "nano-agent.client.cli@v1",
      priority: "normal",
    },
    trace: { trace_uuid: UUID, session_uuid: UUID },
    body: { last_seen_seq: 7 },
  };
  await instance.webSocketMessage(null, JSON.stringify(resumeFrame));
  const seqKey = `tenants/${TEAM_UUID}/session:lastSeenSeq`;
  assert.equal(store.get(seqKey), 7);
});

test("B9 GPT-R3 — raw doState.storage.* calls live only inside the tenant wrapper", () => {
  const source = readFileSync(DO_SOURCE, "utf-8");
  const lines = source.split("\n");

  // Locate every "doState.storage." call site (put / get / delete /
  // setAlarm). Then ensure it lives inside one of the allowed enclosing
  // functions — the list below is the only B9-approved set of sites.
  const ALLOWED_ENCLOSING = new Set([
    "getTenantScopedStorage", // wrapper — raw access here is expected
    "wsHelperStorage", // retained as the legacy helper entry; now re-reads via the tenant-scoped proxy
    "alarm", // DO alarm() hook — setAlarm only, no KV
    "handleWebSocketUpgrade", // setAlarm — non-KV operation
  ]);

  const violations = [];
  const callSiteRegex = /this\.doState\.storage/;
  let currentFunction = null;
  const functionStartRegex = /(?:private|public|protected)?\s*(?:async\s+)?(?:static\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:<[^>]*>)?\s*\([^)]*\)[^{]*\{/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fnMatch = line.match(functionStartRegex);
    if (fnMatch) {
      const name = fnMatch[1];
      // Skip keywords and generic names
      if (
        ![
          "if",
          "for",
          "while",
          "switch",
          "catch",
          "return",
          "throw",
          "case",
          "function",
          "constructor",
          "new",
        ].includes(name)
      ) {
        currentFunction = name;
      }
    }
    if (callSiteRegex.test(line)) {
      // For the get/put/delete KV calls specifically, verify wrapper enclosure.
      // Non-KV operations (setAlarm, null-check, assignment) are allowed
      // in any function on the list above.
      if (!currentFunction || !ALLOWED_ENCLOSING.has(currentFunction)) {
        violations.push(
          `line ${i + 1} (in function '${currentFunction ?? "<top-level>"}'): ${line.trim()}`,
        );
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    `Found ${violations.length} raw doState.storage.* call(s) outside the tenant-wrapper white-list:\n${violations.join("\n")}`,
  );
});

test("B9 GPT-R4 — http-controller no longer hardcodes '1.1.0'", () => {
  const HTTP_CONTROLLER = join(
    REPO_ROOT,
    "packages/session-do-runtime/src/http-controller.ts",
  );
  const source = readFileSync(HTTP_CONTROLLER, "utf-8");
  assert.ok(
    !source.includes('schema_version: "1.1.0"'),
    "http-controller.ts still has hardcoded schema_version: \"1.1.0\" — B9 GPT-R4 requires NACP_VERSION import",
  );
  assert.ok(
    source.includes("NACP_VERSION"),
    "http-controller.ts should import NACP_VERSION from @nano-agent/nacp-core",
  );
});
