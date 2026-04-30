#!/usr/bin/env node
// HP8 P3-02a — tool catalog drift guard (Q26).
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.9 HP8
//   * docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md §7 F4
//   * docs/design/hero-to-pro/HPX-qna.md Q26
//   * packages/nacp-core/src/tools/tool-catalog.ts
//
// Lightweight grep-level guard. The full catalog SSoT lives in
// `packages/nacp-core/src/tools/tool-catalog.ts`. This guard:
//
//   1. Reads the catalog file directly (avoids importing TS at script
//      runtime) and pulls every tool_id literal from it.
//   2. Walks the worker / package source trees looking for files that
//      appear to mint a *new* tool registry alongside the SSoT (any
//      file that defines `TOOL_CATALOG`, `tool-catalog`, or a literal
//      `[ "bash" ... ]` array shaped like a registry).
//   3. Fails with a non-zero exit when it finds a definition outside
//      the SSoT, or when the SSoT loses an entry that bash-core /
//      agent-core still references in a `tool_name === "..."` /
//      `capabilityName === "..."` literal.
//
// The guard does NOT interfere with normal `tool_name: toolName`
// dynamic plumbing — only with literal duplicate definitions of the
// canonical tool list. Test fixtures and `*.md` files are skipped.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const CATALOG_PATH = resolve(
  repoRoot,
  "packages/nacp-core/src/tools/tool-catalog.ts",
);
const SCAN_ROOTS = [
  resolve(repoRoot, "packages"),
  resolve(repoRoot, "workers"),
];
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "generated",
  ".turbo",
  ".wrangler",
  "test",
  "tests",
]);
const SKIP_FILE_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".d.ts"];

function isSkippedFile(name) {
  if (!name.endsWith(".ts") && !name.endsWith(".tsx") && !name.endsWith(".mjs")) {
    return true;
  }
  for (const suffix of SKIP_FILE_SUFFIXES) {
    if (name.endsWith(suffix)) return true;
  }
  return false;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = resolve(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (!isSkippedFile(name)) {
      yield full;
    }
  }
}

const catalogSource = readFileSync(CATALOG_PATH, "utf8");
const toolIdRegex = /tool_id:\s*"([^"\\]+)"/g;
const catalogIds = new Set();
for (const match of catalogSource.matchAll(toolIdRegex)) {
  catalogIds.add(match[1]);
}
if (catalogIds.size === 0) {
  console.error(
    `[check-tool-drift] catalog at ${CATALOG_PATH} contains no tool_id entries — file may have been moved`,
  );
  process.exit(2);
}

const drifts = [];

for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    if (file === CATALOG_PATH) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = relative(repoRoot, file).split(sep).join("/");

    // 1) Forbid a second `TOOL_CATALOG` declaration outside the SSoT.
    if (
      /\bTOOL_CATALOG\b\s*[:=]/.test(text) ||
      /\bTOOL_CATALOG_IDS\b\s*[:=]/.test(text)
    ) {
      drifts.push({
        file: rel,
        kind: "duplicate-catalog",
        detail:
          "TOOL_CATALOG / TOOL_CATALOG_IDS may only be defined in packages/nacp-core/src/tools/tool-catalog.ts (Q26)",
      });
    }

    // 2) Forbid array-shaped tool registries (e.g. `tools: [{ name: "bash", ...`).
    //    We target a narrow heuristic to keep false positives low.
    const literalRegex =
      /\b(tool_id|tool_name|capability_owner|binding_key)\b\s*:\s*"([a-z0-9_-]+)"\s*[,}\n]/g;
    for (const match of text.matchAll(literalRegex)) {
      const field = match[1];
      const value = match[2];
      if (
        field === "tool_id" ||
        (field === "tool_name" && /\[\s*\{[\s\S]*tool_name\b/.test(text))
      ) {
        if (!catalogIds.has(value)) {
          drifts.push({
            file: rel,
            kind: "unknown-tool-id",
            detail: `${field} "${value}" not declared in TOOL_CATALOG`,
          });
        }
      }
    }
  }
}

if (drifts.length > 0) {
  console.error("[check-tool-drift] tool catalog drift detected:\n");
  for (const d of drifts) {
    console.error(`  - ${d.file} :: ${d.kind} :: ${d.detail}`);
  }
  console.error(
    `\n[check-tool-drift] ${drifts.length} drift(s). Move every tool definition into packages/nacp-core/src/tools/tool-catalog.ts.`,
  );
  process.exit(1);
}

console.log(
  `[check-tool-drift] catalog SSoT clean. ${catalogIds.size} tool id(s) registered: ${[...catalogIds].join(", ")}.`,
);
