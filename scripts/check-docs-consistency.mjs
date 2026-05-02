#!/usr/bin/env node
// HPX5 P5-05 — docs consistency CI gate.
//
// Verifies the 19-doc pack under clients/api-docs/ has zero drift on
// the contract points HPX5 / HPX6 / HP9 froze:
//
//   1. `index\.ts:[0-9]+` — no failed implementation references after
//      the orchestrator-core modular refactor.
//   2. `effective_model_id` zero hits — model.fallback schema field is
//      `fallback_model_id` (HPX5 F4 / stream-event.ts:139-145).
//   3. `session_status: "running"` zero hits — canonical 7-value enum
//      has no `running` (transport-profiles.md / GPT §6.5).
//   4. `content_source.*filesystem-core-leaf-rpc-pending` zero hits —
//      HPX5 F5 wired the binary GET; placeholder is now `live`.
//
// Exits 1 if any check fails.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DOCS_DIR = new URL("../clients/api-docs/", import.meta.url).pathname;

const checks = [
  {
    name: "no failed `workers/orchestrator-core/src/index.ts:NNN` references",
    pattern: /workers\/orchestrator-core\/src\/index\.ts:[0-9]+/g,
    severity: "error",
    note: "orchestrator-core index.ts is 18 lines after modular refactor; refresh ref to facade/routes/* or *-control-plane.ts",
  },
  {
    name: "model.fallback WS frame body uses fallback_model_id (not effective_model_id)",
    // Only flag occurrences inside a `{...}` shape that includes
    // `model.fallback` — `effective_model_id` is a valid D1 audit column
    // name (`nano_conversation_turns`) and may legitimately appear in
    // session-truth / models audit contexts.
    pattern: /model\.fallback[^\n]*effective_model_id|effective_model_id[^\n]*model\.fallback/g,
    severity: "error",
    note: "stream-event.ts:139-145 uses fallback_model_id; HPX5 F4 docs.",
  },
  {
    name: "session_status enum has no `running` value",
    pattern: /session_status['"\s:]+["']running["']/g,
    severity: "error",
    note: "session.md §1 lifecycle: pending|starting|active|attached|detached|ended|expired",
  },
  {
    name: "workspace content_source not pending (HPX5 F5 wired)",
    pattern: /content_source[^a-z]+filesystem-core-leaf-rpc-pending/g,
    severity: "error",
    note: "HPX5 F5 set content_source: \"live\" once readTempFile RPC binary GET went live",
  },
];

function listDocs(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({ name, path: join(dir, name) }));
}

function runChecks() {
  const docs = listDocs(DOCS_DIR);
  let failures = 0;
  for (const { name, path } of docs) {
    const text = readFileSync(path, "utf8");
    for (const check of checks) {
      const matches = text.match(check.pattern) ?? [];
      if (matches.length > 0) {
        failures += matches.length;
        console.error(
          `[FAIL] ${name}: ${matches.length} hit(s) — ${check.name}\n        first hit: ${matches[0]}\n        note: ${check.note}`,
        );
      }
    }
  }
  if (failures > 0) {
    console.error(`\nTotal: ${failures} consistency violations across ${docs.length} docs`);
    process.exit(1);
  }
  console.log(`OK: ${docs.length} docs pass ${checks.length} consistency checks`);
}

runChecks();
