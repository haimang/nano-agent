#!/usr/bin/env node
// HP8 P3-02b — public envelope drift guard (Q27).
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.9 HP8
//   * docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md §7 F5
//   * docs/design/hero-to-pro/HPX-qna.md Q27
//
// Public HTTP responses must shape themselves as `FacadeEnvelope`
// (`{ ok, data | error, trace_uuid }`). Internal `Envelope<T>` and
// `AuthEnvelope<T>` are intentionally retained for worker-to-worker
// RPC; Q27 forbids removing them. This guard scopes to *public-facing*
// orchestrator-core source only and looks for two failure modes:
//
//   1. A public route handler imports `AuthEnvelope` / `Envelope` from
//      `@haimang/orchestrator-auth-contract` or `@haimang/nacp-core`
//      and uses it to *construct* the response body (not just to type
//      a downstream RPC argument).
//   2. A public route handler responds with a body that lacks the
//      `ok:` / `error:` discriminator that FacadeEnvelope mandates,
//      while clearly being on a public path (returns from one of the
//      `handle…` exports we know go to `worker.fetch`).
//
// HP8 first wave keeps the heuristic conservative: we flag any
// `Response.json({ ok:` payload missing `trace_uuid:` AND any code
// path that explicitly returns an `AuthEnvelope` literal in the public
// orchestrator-core surface. Internal RPC paths are out of scope.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

// Public-only scope per Q27. We deliberately do NOT scan
// `workers/orchestrator-core/src/user-do*` or any internal RPC path.
const PUBLIC_FILES = [
  "workers/orchestrator-core/src/index.ts",
];

const drifts = [];

for (const rel of PUBLIC_FILES) {
  const file = resolve(repoRoot, rel);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    drifts.push({
      file: rel,
      kind: "scan-failed",
      detail: err.message,
    });
    continue;
  }

  // Failure mode 1: public route returning a literal `AuthEnvelope` /
  // internal `Envelope` shape. We grep for `: AuthEnvelope<` /
  // `as AuthEnvelope<` / `: Envelope<` / `as Envelope<` annotations.
  // Internal Envelope-typed `req.json<Envelope<X>>()` reads stay legal.
  const annotationRegex = /\b(AuthEnvelope|Envelope)<[^>]*>\s*[=,;)]/g;
  for (const match of text.matchAll(annotationRegex)) {
    const surrounding = text.slice(
      Math.max(0, match.index - 60),
      Math.min(text.length, match.index + 200),
    );
    if (
      /Response\.json\s*\(/.test(surrounding) ||
      /return\s*\{[\s\S]*ok:\s*(true|false)/.test(surrounding)
    ) {
      drifts.push({
        file: rel,
        kind: "public-internal-envelope",
        detail: `${match[0].trim()} appears in a public response body shape`,
      });
    }
  }

  // Failure mode 2: every `Response.json({ ok: …` literal on a public
  // path MUST carry a trace_uuid (FacadeEnvelope contract). We need to
  // balance braces because Response bodies routinely nest `data: {...}`
  // and `error: {...}`. We walk the file looking for `Response.json(`,
  // then scan forward matching `(` against `)` while ignoring strings
  // and template literals; the substring between is the call-site
  // argument list. We then check that argument list (which contains
  // the body literal) for `ok:` AND `trace_uuid:`.
  const callMarker = "Response.json(";
  let cursor = 0;
  while (true) {
    const idx = text.indexOf(callMarker, cursor);
    if (idx === -1) break;
    const argStart = idx + callMarker.length;
    let depth = 1; // we're inside the (
    let i = argStart;
    let inString = null; // '"' / "'" / "`"
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === inString) inString = null;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
      } else if (ch === "(") {
        depth += 1;
      } else if (ch === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
      i += 1;
    }
    const args = text.slice(argStart, i);
    cursor = i + 1;
    if (!/\bok\s*:/.test(args)) continue;
    // FacadeEnvelope contract: { ok, data | error, trace_uuid }.
    // Aggregated probe / health endpoints intentionally use a bespoke
    // shape (no `data` / `error` discriminator) and are documented in
    // the design as a legacy-ack exception. Skip them.
    const hasFacadeDiscriminator =
      /\bdata\s*:/.test(args) || /\berror\s*:/.test(args);
    if (!hasFacadeDiscriminator) continue;
    if (
      !/\btrace_uuid\s*:/.test(args) &&
      !/\.\.\.\s*envelope\s*[,}]/.test(args)
    ) {
      const lineNumber = text.slice(0, idx).split("\n").length;
      drifts.push({
        file: rel,
        kind: "facade-envelope-missing-trace",
        detail: `line ~${lineNumber}: Response.json({ ok, data|error, ... }) missing trace_uuid`,
      });
    }
  }
}

if (drifts.length > 0) {
  console.error("[check-envelope-drift] public envelope drift detected:\n");
  for (const d of drifts) {
    console.error(`  - ${d.file} :: ${d.kind} :: ${d.detail}`);
  }
  console.error(
    `\n[check-envelope-drift] ${drifts.length} drift(s). Q27: public surface MUST emit FacadeEnvelope only.`,
  );
  process.exit(1);
}

console.log(
  `[check-envelope-drift] ${PUBLIC_FILES.length} public file(s) clean.`,
);
