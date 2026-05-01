#!/usr/bin/env node
// HP8-D2 (deferred-closure absorb) — R29 initial-context divergence verifier.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.9 HP8 (R29 in F1-F17)
//   * docs/issue/zero-to-real/R29-postmortem.md (three-choice judgment)
//
// Background: ZX5 R29 was previously labelled `silently resolved` because
// the symptom (initial-context 502) disappeared when the code path was
// removed; postmortem 法律 (Q28) requires us to make the resolution
// EXPLICIT. This script provides the automated entry point for the
// "have-diff vs zero-diff vs unverifiable" three-choice judgment that
// the postmortem doc demands.
//
// Usage:
//   node scripts/verify-initial-context-divergence.mjs --baseline=baseline.json [--candidate=candidate.json]
//   node scripts/verify-initial-context-divergence.mjs --self-test
//
// Inputs:
//   --baseline    JSON file containing canonical initial-context snapshot
//   --candidate   JSON file containing observed initial-context snapshot
//   --self-test   Run a smoke pass that exercises the diff engine with
//                 synthetic baseline + candidate. No real environment
//                 required; lets CI / smoke gate verify the script
//                 itself is healthy.
//
// Output:
//   Exit 0   = `zero-diff`           (baseline === candidate)
//   Exit 1   = `has-diff`            (baseline ≠ candidate; diff report on stderr)
//   Exit 2   = `unverifiable`        (input missing / corrupt; reason on stderr)
//
// The exit code maps directly onto the postmortem three-choice judgment.
// The accompanying `docs/issue/zero-to-real/R29-postmortem.md` doc must
// register the chosen verdict + the script invocation that produced it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const VERDICT_ZERO_DIFF = 0;
const VERDICT_HAS_DIFF = 1;
const VERDICT_UNVERIFIABLE = 2;

function parseArgs(argv) {
  const opts = { baseline: null, candidate: null, selfTest: false };
  for (const raw of argv) {
    if (raw === "--self-test") opts.selfTest = true;
    else if (raw.startsWith("--baseline=")) opts.baseline = raw.slice("--baseline=".length);
    else if (raw.startsWith("--candidate=")) opts.candidate = raw.slice("--candidate=".length);
  }
  return opts;
}

function readJsonOrFail(path) {
  if (!path) {
    return { ok: false, reason: "input-not-provided", value: null };
  }
  let text;
  try {
    text = readFileSync(resolve(process.cwd(), path), "utf8");
  } catch (err) {
    return { ok: false, reason: `read-failed:${err.message}`, value: null };
  }
  try {
    return { ok: true, reason: null, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, reason: `parse-failed:${err.message}`, value: null };
  }
}

// Diff engine — returns the canonical diff array used by both the
// regular run and the self-test. Each diff entry is
// `{ pointer: '/path/to/field', kind: 'value-mismatch' | 'baseline-only' | 'candidate-only', baseline?, candidate? }`.
export function diffSnapshots(baseline, candidate) {
  const diffs = [];
  const baseQueue = [{ ptr: "", value: baseline }];
  const cand = candidate;
  // Walk baseline tree; collect mismatches + baseline-only.
  while (baseQueue.length > 0) {
    const { ptr, value } = baseQueue.pop();
    const candValue = lookup(cand, ptr);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      if (typeof candValue !== "object" || candValue === null || Array.isArray(candValue)) {
        diffs.push({ pointer: ptr || "/", kind: "value-mismatch", baseline: value, candidate: candValue ?? null });
        continue;
      }
      for (const [k, v] of Object.entries(value)) {
        baseQueue.push({ ptr: `${ptr}/${escapePtr(k)}`, value: v });
      }
      for (const k of Object.keys(candValue)) {
        if (!(k in value)) {
          diffs.push({
            pointer: `${ptr}/${escapePtr(k)}`,
            kind: "candidate-only",
            candidate: candValue[k],
          });
        }
      }
    } else {
      if (!equal(value, candValue)) {
        diffs.push({ pointer: ptr || "/", kind: "value-mismatch", baseline: value, candidate: candValue ?? null });
      }
    }
  }
  return diffs;
}

function escapePtr(key) {
  return String(key).replace(/~/g, "~0").replace(/\//g, "~1");
}

function lookup(value, pointer) {
  if (!pointer) return value;
  const parts = pointer.split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur = value;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!equal(a[i], b[i])) return false;
    }
    return true;
  }
  return false;
}

function runSelfTest() {
  const baseline = { phase: "active", session: { uuid: "abc", model: "granite" } };
  const candidate1 = { phase: "active", session: { uuid: "abc", model: "granite" } };
  const candidate2 = { phase: "ended", session: { uuid: "abc", model: "granite", drift: 1 } };
  const zero = diffSnapshots(baseline, candidate1);
  const some = diffSnapshots(baseline, candidate2);
  if (zero.length !== 0) {
    console.error("[self-test] expected zero-diff, got", JSON.stringify(zero));
    return VERDICT_UNVERIFIABLE;
  }
  if (some.length === 0) {
    console.error("[self-test] expected has-diff, got zero diffs");
    return VERDICT_UNVERIFIABLE;
  }
  console.log("[verify-initial-context-divergence] self-test pass");
  return VERDICT_ZERO_DIFF;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.selfTest) {
    process.exit(runSelfTest());
    return;
  }
  const base = readJsonOrFail(opts.baseline);
  if (!base.ok) {
    console.error(`[verify-initial-context-divergence] baseline ${base.reason}`);
    process.exit(VERDICT_UNVERIFIABLE);
    return;
  }
  const cand = readJsonOrFail(opts.candidate);
  if (!cand.ok) {
    console.error(`[verify-initial-context-divergence] candidate ${cand.reason}`);
    process.exit(VERDICT_UNVERIFIABLE);
    return;
  }
  const diffs = diffSnapshots(base.value, cand.value);
  if (diffs.length === 0) {
    console.log("[verify-initial-context-divergence] zero-diff");
    process.exit(VERDICT_ZERO_DIFF);
    return;
  }
  console.error(`[verify-initial-context-divergence] has-diff (${diffs.length} differences)`);
  for (const d of diffs.slice(0, 50)) {
    console.error(`  ${d.kind} @ ${d.pointer || "/"}`);
  }
  if (diffs.length > 50) {
    console.error(`  ... +${diffs.length - 50} more diffs`);
  }
  process.exit(VERDICT_HAS_DIFF);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
