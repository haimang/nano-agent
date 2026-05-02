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
//   5. confirmation/todo/model.fallback readiness must not regress to
//      `emitter pending` / `emitter-not-live` after HPX5.
//   6. confirmation kind must be `tool_permission` on public docs;
//      decision body examples must use canonical `status` +
//      `decision_payload`.
//   7. `session.md` + `session-ws-v1.md` must both mention
//      `first_event_seq` (HPX5 F7 start→attach race fix).
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
  {
    name: "confirmation/todo frame docs are not stale `emitter pending` after HPX5",
    pattern:
      /session\.confirmation\.(request|update)[\s\S]{0,240}emitter pending|session\.todos\.(write|update)[\s\S]{0,240}emitter pending/g,
    severity: "error",
    note: "HPX5 F1/F2 made confirmation + todos top-level frames live.",
  },
  {
    name: "model.fallback is not marked emitter-not-live after HPX5",
    pattern: /model\.fallback[^\n]*emitter-not-live|emitter-not-live[^\n]*model\.fallback/g,
    severity: "error",
    note: "HPX5 F4 emits model.fallback when fallback_used=true at turn close.",
  },
  {
    name: "confirmation request kind uses tool_permission (not permission)",
    pattern:
      /session\.confirmation\.request\{[^}\n]*(kind|confirmation_kind):\s*"permission"|kind\s*=\s*`permission`/g,
    severity: "error",
    note: "HP5 public confirmation kind is tool_permission; `permission` is legacy wording only.",
  },
  {
    name: "confirmation decision examples use canonical status + decision_payload",
    pattern:
      /\/confirmations\/\{uuid\}\/decision[^\n]*\bdecision:\s*"|\/confirmations\/\{uuid\}\/decision[^\n]*\bpayload:\s*\{/g,
    severity: "error",
    note: "Canonical confirmation decision body is { status, decision_payload }.",
  },
];

const requiredChecks = [
  {
    file: "session.md",
    snippet: "first_event_seq",
    note: "HPX5 F7 requires session.md to document `/start` first_event_seq.",
  },
  {
    file: "session-ws-v1.md",
    snippet: "first_event_seq",
    note: "HPX5 F7 requires session-ws-v1.md to document the start→attach handoff.",
  },
];

function listDocs(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({ name, path: join(dir, name) }));
}

function runChecks() {
  const docs = listDocs(DOCS_DIR);
  const regexCheckCount = checks.length;
  const requiredCheckCount = requiredChecks.length;
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
    for (const required of requiredChecks) {
      if (required.file !== name) continue;
      if (!text.includes(required.snippet)) {
        failures += 1;
        console.error(
          `[FAIL] ${name}: missing required snippet \`${required.snippet}\`\n        note: ${required.note}`,
        );
      }
    }
  }
  if (failures > 0) {
    console.error(`\nTotal: ${failures} consistency violations across ${docs.length} docs`);
    process.exit(1);
  }
  console.log(
    `OK: ${docs.length} docs pass ${regexCheckCount} regex checks + ${requiredCheckCount} required-snippet checks`,
  );
}

runChecks();
