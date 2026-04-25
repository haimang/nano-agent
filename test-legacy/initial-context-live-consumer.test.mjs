import test from "node:test";
import assert from "node:assert/strict";

/**
 * P2 Phase 5 — root e2e #2: initial_context live consumer (dedicated).
 *
 * Per action-plan §S10 + P1-P5 GPT review R1, asserts:
 *   (a) no throw when session.start carries a valid initial_context;
 *   (b) `AssemblyResult.assembled` (and thus `AssemblyEvidenceRecord
 *       .assembledKinds`) contains the canonical `session` kind that
 *       `appendInitialContextLayer` maps payloads to — NEVER an
 *       invented `initial_context` kind;
 *   (c) negative comparison: same DO without initial_context yields
 *       an assembly with no content from the payload — demonstrating
 *       the consumer had an observable effect.
 *
 * Run in-process (node:test) — no preview URL dependency. Uses the
 * published `ContextAssembler` + the host helper + the DO class to
 * exercise the real consumer path end-to-end at the host layer.
 */

import { NanoSessionDO } from "../packages/session-do-runtime/dist/index.js";
import {
  peekPendingInitialContextLayers,
  drainPendingInitialContextLayers,
} from "../packages/session-do-runtime/dist/context-api/append-initial-context-layer.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";

test("(a) session.start with initial_context does not throw and populates pending layer", async () => {
  const doInstance = new NanoSessionDO(
    {},
    { TEAM_UUID: "team-e2e", SESSION_UUID },
  );
  await doInstance.dispatchAdmissibleFrame("session.start", {
    initial_input: "hello world",
    initial_context: {
      intent: { route: "e2e", realm: "staging", confidence: 0.9 },
      user_memory: { pinned_tone: "neutral" },
    },
  });
  const workspace = doInstance.getSubsystems().workspace;
  const pending = peekPendingInitialContextLayers(workspace.assembler);
  assert.ok(pending.length >= 1, "pending layers should contain >=1 layer after session.start");
});

test("(b) assembler.assemble(drain) yields 'session' kind in assembled — NEVER 'initial_context'", async () => {
  const doInstance = new NanoSessionDO(
    {},
    { TEAM_UUID: "team-e2e-b", SESSION_UUID },
  );
  await doInstance.dispatchAdmissibleFrame("session.start", {
    initial_input: "hi",
    initial_context: {
      intent: { route: "measure-kind" },
    },
  });
  const workspace = doInstance.getSubsystems().workspace;
  const pending = drainPendingInitialContextLayers(workspace.assembler);
  assert.ok(pending.length >= 1);
  const result = workspace.assembler.assemble(pending);
  // R1 load-bearing: kind in assembled is mapped canonical `session`
  // (or `injected` in a future mapping tweak), never the invented
  // `initial_context`.
  const kinds = result.assembled.map((l) => l.kind);
  assert.ok(
    kinds.includes("session"),
    `expected canonical 'session' in assembled kinds; got: ${kinds.join(",")}`,
  );
  for (const k of kinds) {
    assert.notEqual(
      k,
      "initial_context",
      `'initial_context' is NOT a valid ContextLayerKind; found one in assembled (${k})`,
    );
  }
  assert.ok(result.totalTokens > 0, "assembler should report a non-zero token count for the session-kind content");
});

test("(c) negative comparison: session.start WITHOUT initial_context yields empty assembled (consumer observable)", async () => {
  const doInstance = new NanoSessionDO(
    {},
    { TEAM_UUID: "team-e2e-c", SESSION_UUID },
  );
  await doInstance.dispatchAdmissibleFrame("session.start", {
    initial_input: "no-context",
  });
  const workspace = doInstance.getSubsystems().workspace;
  const pending = drainPendingInitialContextLayers(workspace.assembler);
  assert.equal(pending.length, 0, "no initial_context → pending list is empty");
  const result = workspace.assembler.assemble(pending);
  assert.equal(
    result.assembled.length,
    0,
    "without initial_context and without other turn-level layers, assembled must be empty",
  );
});

test("(d) positive vs negative content diff: same intent text yields non-zero totalTokens only in positive case", async () => {
  const positive = new NanoSessionDO(
    {},
    { TEAM_UUID: "team-e2e-d1", SESSION_UUID },
  );
  await positive.dispatchAdmissibleFrame("session.start", {
    initial_input: "hi",
    initial_context: {
      intent: { route: "diff-positive", realm: "stage-1", confidence: 0.5 },
      user_memory: { note: "the quick brown fox jumps over the lazy dog" },
    },
  });
  const positiveWs = positive.getSubsystems().workspace;
  const positiveLayers = drainPendingInitialContextLayers(positiveWs.assembler);
  const positiveResult = positiveWs.assembler.assemble(positiveLayers);

  const negative = new NanoSessionDO(
    {},
    { TEAM_UUID: "team-e2e-d2", SESSION_UUID },
  );
  await negative.dispatchAdmissibleFrame("session.start", {
    initial_input: "hi",
  });
  const negativeWs = negative.getSubsystems().workspace;
  const negativeLayers = drainPendingInitialContextLayers(negativeWs.assembler);
  const negativeResult = negativeWs.assembler.assemble(negativeLayers);

  assert.ok(
    positiveResult.totalTokens > negativeResult.totalTokens,
    `positive totalTokens (${positiveResult.totalTokens}) must exceed negative (${negativeResult.totalTokens})`,
  );
  assert.equal(
    negativeResult.totalTokens,
    0,
    "negative case has no layers → totalTokens must be 0",
  );
});
