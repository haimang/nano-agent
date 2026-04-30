#!/usr/bin/env node
/**
 * RHX2 review-of-reviews fix (GLM R4 / GPT R4 / kimi R2).
 *
 * Lightweight drift guard for the 6-worker production code surface.
 * Replaces the abandoned ESLint requirement from action-plan P4-05 with
 * a self-contained Node script that:
 *
 *   1. Forbids bare `console.{log,warn,error,info,debug}` calls in
 *      `workers/<worker>/src/`. The structured logger is the only
 *      sanctioned sink. (Calls inside test/script files are allowed.)
 *   2. Forbids cross-worker imports between the 6 workers. Every
 *      cross-worker dependency MUST go through the published packages
 *      (`@haimang/nacp-core`, `@haimang/nacp-session`, `@haimang/jwt-shared`)
 *      or service bindings.
 *
 * Usage:
 *   node scripts/check-observability-drift.mjs
 *
 * Exit code 1 on any violation. Wire into CI (e.g. predeploy or root
 * pretest) to keep RHX2 F10 enforced.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const WORKERS = [
  "agent-core",
  "bash-core",
  "context-core",
  "filesystem-core",
  "orchestrator-auth",
  "orchestrator-core",
];
const CONSOLE_RE = /\bconsole\.(log|warn|error|info|debug)\b/;
const SUFFIXES = [".ts", ".tsx", ".mts", ".cts"];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "generated") continue;
      walk(path, out);
    } else if (SUFFIXES.some((s) => path.endsWith(s))) {
      out.push(path);
    }
  }
  return out;
}

const violations = [];

for (const worker of WORKERS) {
  const srcDir = join(REPO_ROOT, "workers", worker, "src");
  let files;
  try {
    files = walk(srcDir);
  } catch {
    continue;
  }
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, idx) => {
      // 1. bare console
      if (CONSOLE_RE.test(line) && !line.includes("// drift-guard-allow")) {
        violations.push({
          rule: "no-bare-console",
          file: relative(REPO_ROOT, file),
          line: idx + 1,
          snippet: line.trim(),
        });
      }
      // 2. cross-worker imports
      const importMatch = line.match(/from\s+["']([^"']+)["']/);
      if (importMatch) {
        const spec = importMatch[1];
        for (const otherWorker of WORKERS) {
          if (otherWorker === worker) continue;
          // Detect any path that targets another worker's source tree.
          if (spec.includes(`workers/${otherWorker}/`) || spec.includes(`/${otherWorker}/src`)) {
            violations.push({
              rule: "no-cross-worker-import",
              file: relative(REPO_ROOT, file),
              line: idx + 1,
              snippet: line.trim(),
            });
          }
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error(`drift-guard: ${violations.length} violation(s)`);
  for (const v of violations) {
    console.error(`  [${v.rule}] ${v.file}:${v.line}  ${v.snippet}`);
  }
  process.exit(1);
}

console.log(
  `drift-guard: clean (scanned ${WORKERS.length} workers; no bare console, no cross-worker imports)`,
);
