import test from "node:test";
import assert from "node:assert/strict";

import {
  SessionStartInitialContextSchema,
  SessionStartBodySchema,
} from "../packages/nacp-session/dist/index.js";

// B9 root contract — SessionStartInitialContextSchema upstream memory
// injection wire hook. See docs/rfc/nacp-core-1-3-draft.md §6 and
// docs/action-plan/after-foundations/B9-nacp-1-3-contract-freeze.md §4.4 P4-03.

test("B9 §6.1 — accepts full valid upstream context", () => {
  const r = SessionStartInitialContextSchema.safeParse({
    user_memory: { favorite_color: "blue" },
    intent: { route: "coding.task", realm: "dev", confidence: 0.92 },
    warm_slots: [{ key: "recent_file", value: "a.ts" }],
    realm_hints: { timezone: "UTC" },
  });
  assert.equal(r.success, true);
});

test("B9 §6.1 — accepts empty object (every sub-field optional)", () => {
  const r = SessionStartInitialContextSchema.safeParse({});
  assert.equal(r.success, true);
});

test("B9 §6.1 — passthrough: unknown keys do not reject", () => {
  const r = SessionStartInitialContextSchema.safeParse({
    user_memory: { x: 1 },
    some_future_key: { z: 2 },
  });
  assert.equal(r.success, true);
});

test("B9 §6.1 — rejects invalid shape (intent.confidence > 1)", () => {
  const r = SessionStartInitialContextSchema.safeParse({
    intent: { confidence: 1.5 },
  });
  assert.equal(r.success, false);
});

test("B9 §6.1 — rejects invalid shape (warm_slots non-array)", () => {
  const r = SessionStartInitialContextSchema.safeParse({
    warm_slots: "not-an-array",
  });
  assert.equal(r.success, false);
});

test("B9 §6.2 — SessionStartBodySchema back-compat: old loose initial_context still parses", () => {
  // This exercises the back-compat pledge: a pre-B9 `initial_context`
  // payload that was just a loose record MUST continue to parse under the
  // tightened schema because SessionStartInitialContextSchema is
  // passthrough with every field optional.
  const r = SessionStartBodySchema.safeParse({
    initial_input: "hi",
    initial_context: {
      unstructured_legacy_key: "anything goes",
      another_key: 42,
    },
  });
  assert.equal(r.success, true);
});

test("B9 §6.2 — SessionStartBodySchema still accepts empty body", () => {
  const r = SessionStartBodySchema.safeParse({});
  assert.equal(r.success, true);
});
