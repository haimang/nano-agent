#!/usr/bin/env node
// HP8 P3-01 — stop-the-bleed megafile budget gate (Q25).
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.9 HP8
//   * docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md §7 F3
//   * docs/design/hero-to-pro/HPX-qna.md Q25
//   * scripts/megafile-budget.json
//
// Reads the budget from `scripts/megafile-budget.json`, counts lines for
// each listed file, and exits non-zero on any breach. Any new entry MUST
// be smaller than the current line count (stop-the-bleed); raising a
// ceiling is a code review smell and will surface in PR diff.
//
// Wrapper / generated / manifest files are NOT in the budget — they are
// not owners. The HP8 design (§3.1) explicitly carves wrapper files out.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const budgetPath = resolve(__dirname, "megafile-budget.json");
const budget = JSON.parse(readFileSync(budgetPath, "utf8"));

if (!Array.isArray(budget.limits)) {
  console.error(
    "[check-megafile-budget] malformed budget.json: missing `limits` array",
  );
  process.exit(2);
}

let breachedCount = 0;
const rows = [];

for (const entry of budget.limits) {
  if (
    typeof entry.path !== "string" ||
    typeof entry.max_lines !== "number"
  ) {
    console.error(
      `[check-megafile-budget] malformed entry: ${JSON.stringify(entry)}`,
    );
    process.exit(2);
  }
  const absolute = resolve(repoRoot, entry.path);
  let lines;
  try {
    const text = readFileSync(absolute, "utf8");
    // mirror `wc -l` semantics: count newline characters, not segments.
    lines = (text.match(/\n/g) ?? []).length;
  } catch (err) {
    console.error(
      `[check-megafile-budget] cannot read ${entry.path}: ${err.message}`,
    );
    process.exit(2);
  }
  const breached = lines > entry.max_lines;
  rows.push({
    path: entry.path,
    owner_class: entry.owner_class ?? "(unspecified)",
    actual: lines,
    max: entry.max_lines,
    breached,
  });
  if (breached) breachedCount += 1;
}

const headerPath = "path".padEnd(64);
const headerOwner = "owner_class".padEnd(28);
console.log(`${headerPath}  ${headerOwner}  actual  max  status`);
for (const r of rows) {
  const status = r.breached ? "BREACH" : "ok";
  console.log(
    `${r.path.padEnd(64)}  ${r.owner_class.padEnd(28)}  ${String(r.actual).padStart(6)}  ${String(r.max).padStart(4)}  ${status}`,
  );
}

if (breachedCount > 0) {
  console.error(
    `\n[check-megafile-budget] ${breachedCount} owner file(s) over budget. Stop the bleed: split before merging.`,
  );
  process.exit(1);
}
console.log(
  `\n[check-megafile-budget] ${rows.length} owner file(s) within budget.`,
);
