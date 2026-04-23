/**
 * Cross-package contract — A5 Phase 5 (P5-01) external seam closure.
 *
 * Ties together the three v1 binding-catalog seams against their fake
 * worker fixtures and asserts the unified cross-seam law:
 *
 *   1. The v1 binding catalog freezes exactly capability / hook /
 *      fake-provider; SKILL_WORKERS is reserved.
 *   2. `makeRemoteBindingsFactory()` produces a profile-aware handle
 *      bag so deployed builds can flip seams to remote without
 *      changing the DO class.
 *   3. The hook + capability + fake-provider transports route through
 *      `callBindingJson` / fetch and never silently fall back —
 *      failure paths surface a `CrossSeamError` (or seam-specific
 *      typed error) the dispatcher / executor can act on.
 *   4. `validateCrossSeamAnchor()` insists every cross-seam call
 *      threads `traceUuid + sessionUuid + teamUuid + requestUuid`.
 *
 * P5 (deploy-shaped verification) consumes the same fixtures + factory.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  RESERVED_BINDINGS,
  V1_BINDING_CATALOG,
  resolveCompositionProfile,
  makeRemoteBindingsFactory,
  makeHookTransport,
  makeCapabilityTransport,
  makeProviderFetcher,
  buildCrossSeamHeaders,
  validateCrossSeamAnchor,
  classifySeamError,
  CROSS_SEAM_FAILURE_REASONS,
  CrossSeamError,
  StartupQueue,
} from "../packages/session-do-runtime/dist/index.js";
import { fakeHookFetch } from "./fixtures/external-seams/fake-hook-worker.ts";
import { fakeCapabilityFetch } from "./fixtures/external-seams/fake-capability-worker.ts";
import { fakeProviderFetch } from "./fixtures/external-seams/fake-provider-worker.ts";

const TRACE_UUID = "11111111-1111-4111-8111-111111111111";
const SESSION_UUID = "22222222-2222-4222-8222-222222222222";
const REQUEST_UUID = "33333333-3333-4333-8333-333333333333";
const TEAM_UUID = "team-seam";

test("V1 binding catalog freezes exactly bash-core/hook/fake-provider, SKILL_WORKERS reserved", () => {
  assert.deepEqual([...V1_BINDING_CATALOG], [
    "BASH_CORE",
    "HOOK_WORKER",
    "FAKE_PROVIDER_WORKER",
  ]);
  assert.ok(RESERVED_BINDINGS.includes("SKILL_WORKERS"));
  assert.ok(!V1_BINDING_CATALOG.includes("SKILL_WORKERS"));
});

test("CROSS_SEAM_FAILURE_REASONS exposes the five-way taxonomy", () => {
  assert.deepEqual([...CROSS_SEAM_FAILURE_REASONS], [
    "not-connected",
    "transport-error",
    "timeout",
    "cancelled",
    "not-ready",
  ]);
});

test("buildCrossSeamHeaders + validateCrossSeamAnchor enforce trace + tenant identity", () => {
  const anchor = {
    traceUuid: TRACE_UUID,
    sessionUuid: SESSION_UUID,
    teamUuid: TEAM_UUID,
    requestUuid: REQUEST_UUID,
  };
  assert.deepEqual(validateCrossSeamAnchor(anchor), []);
  const headers = buildCrossSeamHeaders(anchor);
  assert.equal(headers["x-nacp-trace-uuid"], TRACE_UUID);
  assert.equal(headers["x-nacp-team-uuid"], TEAM_UUID);

  // A bare envelope must surface every missing field, not just one.
  const missing = validateCrossSeamAnchor({});
  assert.deepEqual([...missing].sort(), [
    "requestUuid",
    "sessionUuid",
    "teamUuid",
    "traceUuid",
  ]);
});

test("hook seam: real fake-hook-worker round trip via makeHookTransport", async () => {
  const binding = { fetch: fakeHookFetch };
  const transport = makeHookTransport(binding);
  assert.ok(transport, "hook transport must materialise when binding is present");
  const result = await transport.call({
    handler: { id: "h1", event: "PreToolUse" },
    emitBody: { event_name: "PreToolUse", event_payload: { tool_name: "Bash" } },
    context: {},
  });
  assert.equal(result.body.ok, true);
  assert.equal(result.body.additional_context, "ok");
});

test("hook seam: failure mode classifies as transport-error via classifySeamError", async () => {
  const binding = { fetch: (req) => fakeHookFetch(new Request(req.url + "?mode=throw", req)) };
  const transport = makeHookTransport(binding);
  let caught;
  try {
    await transport.call({
      handler: { id: "h1", event: "PreToolUse" },
      emitBody: { event_name: "PreToolUse", event_payload: {} },
      context: {},
    });
  } catch (e) {
    caught = classifySeamError("hook", e);
  }
  assert.ok(caught instanceof CrossSeamError);
  assert.equal(caught.reason, "transport-error");
  assert.equal(caught.seam, "hook");
});

test("capability seam: fake-capability-worker round trip + cancel", async () => {
  const binding = { fetch: fakeCapabilityFetch };
  const transport = makeCapabilityTransport(binding);
  assert.ok(transport);
  const result = await transport.call({
    requestId: REQUEST_UUID,
    capabilityName: "grep",
    body: { tool_name: "grep", tool_input: {} },
  });
  assert.equal(result.status, "ok");
  await transport.cancel({ requestId: REQUEST_UUID, body: { reason: "user" } });
});

test("provider seam: fake-provider-worker streams an SSE response with trailing [DONE]", async () => {
  const binding = { fetch: fakeProviderFetch };
  const fetcher = makeProviderFetcher(binding);
  assert.ok(fetcher);
  const res = await fetcher("https://internal.local/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stream: true,
      model: "gpt-fake-1",
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.includes("[DONE]"));
});

test("composition factory: profile flips per binding presence", () => {
  const factory = makeRemoteBindingsFactory();
  const env = {
    SESSION_DO: {},
    R2_ARTIFACTS: {},
    KV_CONFIG: {},
    HOOK_WORKER: { fetch: fakeHookFetch },
    BASH_CORE: { fetch: fakeCapabilityFetch },
  };
  const handles = factory.create(env, {
    heartbeatIntervalMs: 1000,
    ackTimeoutMs: 1000,
    maxTurnSteps: 1,
    checkpointOnTurnEnd: false,
    httpFallbackEnabled: true,
  });
  assert.equal(handles.profile.hooks, "remote");
  assert.equal(handles.profile.capability, "remote");
  assert.equal(handles.profile.provider, "local");
  assert.ok(handles.hooks);
  assert.ok(handles.capability);
  assert.ok(!handles.llm);
});

test("StartupQueue replays buffered events on markReady, drops with not-ready failure", async () => {
  const queue = new StartupQueue();
  queue.enqueue({ kind: "edge.attach" });
  queue.enqueue({ kind: "edge.detach" });
  const seen = [];
  await queue.markReady((event) => {
    seen.push(event);
  });
  assert.deepEqual(seen.map((e) => e.kind), ["edge.attach", "edge.detach"]);

  const stuck = new StartupQueue();
  stuck.enqueue({ kind: "edge.attach" });
  const dropped = stuck.drop();
  assert.equal(dropped.length, 1);
  let caught;
  try {
    stuck.enqueue({ kind: "edge.attach" });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof CrossSeamError);
  assert.equal(caught.reason, "not-ready");
});

test("resolveCompositionProfile prefers config override over env signal", () => {
  const profile = resolveCompositionProfile(
    {
      SESSION_DO: {},
      R2_ARTIFACTS: {},
      KV_CONFIG: {},
      HOOK_WORKER: { fetch: fakeHookFetch },
    },
    {
      heartbeatIntervalMs: 1000,
      ackTimeoutMs: 1000,
      maxTurnSteps: 1,
      checkpointOnTurnEnd: false,
      httpFallbackEnabled: true,
      compositionProfile: { capability: "local", hooks: "local", provider: "local" },
    },
  );
  assert.equal(profile.hooks, "local");
});
