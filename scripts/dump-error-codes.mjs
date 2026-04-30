#!/usr/bin/env node
/**
 * Dev helper — emit the unified error registry as markdown table rows
 * grouped by source. Used to author / refresh `docs/api/error-codes.md`.
 *
 * Usage:  node scripts/dump-error-codes.mjs > /tmp/error-codes.md
 */
import { listErrorMetas } from "../packages/nacp-core/dist/index.js";

const metas = listErrorMetas();
const bySource = new Map();
for (const m of metas) {
  if (!bySource.has(m.source)) bySource.set(m.source, []);
  bySource.get(m.source).push(m);
}
console.log(`# nano-agent error catalog (auto-snapshot)\n`);
for (const [src, list] of bySource) {
  console.log(`\n## ${src}  (${list.length} codes)\n`);
  console.log(`| code | category | http_status | retryable | message |`);
  console.log(`|---|---|---|---|---|`);
  for (const m of list) {
    console.log(
      `| \`${m.code}\` | ${m.category} | ${m.http_status} | ${m.retryable ? "yes" : "no"} | ${m.message.replace(/\|/g, "\\|")} |`,
    );
  }
}
