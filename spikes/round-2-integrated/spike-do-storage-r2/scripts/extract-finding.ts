#!/usr/bin/env node
/**
 * extract-finding.ts — convert `.out/*.json` (IntegratedProbeResult)
 * into round-2 closure-section drafts for `docs/spikes/spike-do-storage/*.md`.
 *
 * The script does NOT modify finding docs directly; it writes to
 * stdout so the human reviewer can inspect the draft before committing.
 * This prevents the "spike scripts silently rewrote finding state" hazard
 * called out in B7 §7.3.
 *
 * Exit codes:
 *   0 — at least one .out JSON parsed successfully and a draft was
 *       printed; any still-open / gated probes are surfaced in a
 *       trailing summary block.
 *   1 — input directory missing or no parseable .out JSON.
 *   2 — any probe's verdict is `still-open` AND gate is undeclared —
 *       by contract (B7 §10) that means the phase is not closed.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface IntegratedProbeResult {
  validationItemId: string;
  findingId?: string;
  verdict: "writeback-shipped" | "dismissed-with-rationale" | "still-open";
  success: boolean;
  skipped?: boolean;
  gate?: string;
  usedPackages: ReadonlyArray<string>;
  caveats: ReadonlyArray<string>;
  observations: { label: string; value: unknown; unit?: string }[];
  evidenceRefs: { kind: string; locator: string }[];
}

function main() {
  const outDir = process.argv[2] ?? ".out";
  let files: string[];
  try {
    files = readdirSync(outDir).filter((f) => f.endsWith(".json"));
  } catch {
    console.error(`input directory not found: ${outDir}`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`no .json files in: ${outDir}`);
    process.exit(1);
  }

  const stillOpenUngated: string[] = [];
  for (const file of files) {
    const raw = readFileSync(join(outDir, file), "utf8");
    let result: IntegratedProbeResult;
    try {
      result = JSON.parse(raw);
    } catch {
      console.error(`skip unparseable: ${file}`);
      continue;
    }

    console.log("\n---");
    console.log(
      `## Round-2 closure — ${result.findingId ?? "(unspecified)"} / ${result.validationItemId}`,
    );
    console.log("");
    console.log(`- **verdict**: \`${result.verdict}\``);
    console.log(`- **success**: ${result.success}`);
    if (result.skipped) console.log(`- **skipped**: true (gate: \`${result.gate ?? "unknown"}\`)`);
    console.log(
      `- **used packages**: ${result.usedPackages.length ? result.usedPackages.map((p) => `\`${p}\``).join(", ") : "(none; pure follow-up probe)"}`,
    );
    console.log("- **caveats**:");
    for (const c of result.caveats) console.log(`  - ${c}`);
    console.log("- **observations**:");
    for (const o of result.observations) {
      console.log(
        `  - \`${o.label}\`: ${JSON.stringify(o.value)}${o.unit ? ` ${o.unit}` : ""}`,
      );
    }
    console.log("- **evidence**:");
    for (const e of result.evidenceRefs) {
      console.log(`  - ${e.kind}: \`${e.locator}\``);
    }

    if (result.verdict === "still-open" && !result.gate) {
      stillOpenUngated.push(result.findingId ?? result.validationItemId);
    }
  }

  if (stillOpenUngated.length > 0) {
    console.error("\nstill-open without declared gate:");
    for (const id of stillOpenUngated) console.error(`  - ${id}`);
    process.exit(2);
  }
}

main();
