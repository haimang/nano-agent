/**
 * A6 Phase 2 — verification runner unit tests.
 *
 * Exercises the SmokeRecorder + writeVerdictBundle + WorkerHarness
 * trio without needing a real wrangler dev session. Runs under
 * `node --test` so it joins the existing root cross-test gate.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SmokeRecorder,
  WorkerHarness,
  makeSmokeRig,
  writeVerdictBundle,
} from "./verification/smokes/runner.ts";
import { getProfile, ALL_PROFILES } from "./verification/profiles/manifest.ts";
import {
  SMOKE_INVENTORY,
  requiredFor,
  smokeForLayer,
} from "./verification/smokes/inventory.ts";

test("profile manifests load and expose the three frozen profiles", () => {
  const ids = ALL_PROFILES.map((p) => p.id);
  assert.deepEqual(ids, ["local-l0", "remote-dev-l1", "deploy-smoke-l2"]);
  for (const id of ids) {
    const p = getProfile(id);
    assert.equal(p.id, id);
    assert.ok(p.label, `${id} profile must have a label`);
  }
});

test("smoke inventory carries required L1/L2 cases per the action plan", () => {
  // L0 retains every pre-A6 root E2E suite.
  assert.equal(smokeForLayer("L0").length, 6);
  assert.equal(requiredFor("L1").length, 2);
  assert.equal(requiredFor("L2").length, 1);
  assert.ok(SMOKE_INVENTORY.find((c) => c.id === "l2-real-provider"));
});

test("SmokeRecorder green verdict when no failures recorded", () => {
  const rec = new SmokeRecorder({
    scenario: "demo",
    profile: getProfile("local-l0"),
  });
  rec.step("a", "pass", 1);
  rec.step("b", "pass", 2);
  const bundle = rec.build();
  assert.equal(bundle.verdict, "green");
  assert.equal(bundle.summary.passes, 2);
  assert.equal(bundle.summary.failures, 0);
});

test("SmokeRecorder yellow verdict when failures exist but no blocking", () => {
  const rec = new SmokeRecorder({
    scenario: "demo",
    profile: getProfile("local-l0"),
  });
  rec.step("a", "pass", 1);
  rec.step("b", "fail", 2);
  rec.recordFailure("b", new Error("oops"));
  const bundle = rec.build();
  assert.equal(bundle.verdict, "yellow");
  assert.equal(bundle.failureRecord.length, 1);
});

test("SmokeRecorder red verdict when blocking() invoked", () => {
  const rec = new SmokeRecorder({
    scenario: "demo",
    profile: getProfile("remote-dev-l1"),
  });
  rec.block("session edge dry-run failed");
  rec.step("setup", "fail", 1);
  rec.recordFailure("setup", new Error("bad"));
  const bundle = rec.build();
  assert.equal(bundle.verdict, "red");
  assert.deepEqual(bundle.blocking, ["session edge dry-run failed"]);
});

test("local-l0 harness records profileLadder=local-l0-harness for laptop runs", () => {
  const rig = makeSmokeRig({
    scenario: "harness-self-check",
    profileId: "local-l0",
  });
  assert.equal(rig.harness.localFallback, true);
  const bundle = rig.recorder.build();
  assert.equal(bundle.profileLadder, "local-l0-harness");
});

test("remote-dev-l1 harness without baseUrl still flags localFallback in the bundle", () => {
  const rig = makeSmokeRig({
    scenario: "harness-self-check-l1",
    profileId: "remote-dev-l1",
  });
  // No baseUrl was supplied → harness ran locally as a fallback for L1.
  assert.equal(rig.harness.localFallback, true);
  const bundle = rig.recorder.build();
  assert.equal(bundle.profileLadder, "local-l0-harness");
});

test("writeVerdictBundle emits a JSON file with the canonical bundle shape", () => {
  const dir = mkdtempSync(join(tmpdir(), "verdict-bundles-"));
  try {
    const rec = new SmokeRecorder({
      scenario: "writer-check",
      profile: getProfile("local-l0"),
    });
    rec.step("only-step", "pass", 1);
    rec.setLatency({ wsAttachMs: 4, firstByteMs: 7, fullTurnMs: 12 });
    rec.setNotes("smoke runner self-test");
    const bundle = rec.build();
    const { path } = writeVerdictBundle(bundle, { dir });
    assert.ok(path.startsWith(dir));
    const written = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(written.bundleVersion, 1);
    assert.equal(written.profile, "local-l0");
    assert.equal(written.notes, "smoke runner self-test");
    assert.equal(written.latencyBaseline.fullTurnMs, 12);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("WorkerHarness drives a real session.start through NanoSessionDO.fetch()", async () => {
  const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
  const harness = new WorkerHarness({ profileId: "local-l0" });
  const res = await harness.fetch(
    new Request(
      `https://harness.local/sessions/${SESSION_UUID}/start`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initial_input: "hi via harness" }),
      },
    ),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.action, "start");
});

test("WorkerHarness forwards to baseUrl via ambient fetch when remote mode is selected", async () => {
  const SESSION_UUID = "33333333-3333-4333-8333-333333333333";
  const calls = [];
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      calls.push(req);
      return new Response(JSON.stringify({ ok: true, remote: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  try {
    const harness = new WorkerHarness({
      profileId: "remote-dev-l1",
      baseUrl: "https://remote.example.workers.dev",
    });
    const res = await harness.fetch(
      new Request(
        `https://harness.local/sessions/${SESSION_UUID}/start?mode=smoke`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initial_input: "hi remote" }),
        },
      ),
    );
    assert.equal(harness.localFallback, false);
    assert.equal(calls.length, 1);
    const forwarded = calls[0];
    assert.equal(
      forwarded.url,
      `https://remote.example.workers.dev/sessions/${SESSION_UUID}/start?mode=smoke`,
    );
    assert.equal(forwarded.method, "POST");
    assert.equal(forwarded.headers.get("content-type"), "application/json");
    assert.equal(await forwarded.text(), JSON.stringify({ initial_input: "hi remote" }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, remote: true });
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  }
});

test("writeVerdictBundle does not persist when persist=false", () => {
  const dir = mkdtempSync(join(tmpdir(), "verdict-bundles-"));
  try {
    const rec = new SmokeRecorder({
      scenario: "no-persist",
      profile: getProfile("local-l0"),
    });
    const bundle = rec.build();
    writeVerdictBundle(bundle, { dir, persist: false });
    const files = readdirSync(dir);
    assert.equal(files.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
