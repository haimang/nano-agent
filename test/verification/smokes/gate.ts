/**
 * A6 Phase 5 — Gate verdict + P6 handoff pack aggregator.
 *
 * Runs the L1 / L2 smokes end-to-end and aggregates their individual
 * bundles into a single `gate-verdict.json` that reviewers can read to
 * decide whether Phase 5 is open and whether Phase 6 can consume the
 * evidence pack. The aggregator also writes a `p6-handoff.json`
 * pointing at the aggregated evidence so A7 has a stable entry point.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runL1ExternalSeamsSmoke } from "./l1-external-seams.smoke.ts";
import { runL1SessionEdgeSmoke } from "./l1-session-edge.smoke.ts";
import { runL2RealProviderSmoke } from "./l2-real-provider.smoke.ts";
import { requiredFor } from "./inventory.ts";
import type { Verdict, VerdictBundle } from "./runner.ts";

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE_DIR = join(here, "..", "verdict-bundles");

export interface GateVerdict {
  readonly bundleVersion: 1;
  readonly generatedAt: string;
  readonly verdict: Verdict;
  readonly blocking: readonly string[];
  readonly perScenario: Record<string, VerdictBundle>;
  readonly notes: string;
  /** Map of required smoke ids → individual verdicts. */
  readonly requirementSummary: Record<string, Verdict>;
}

export interface GateOptions {
  readonly persist?: boolean;
  readonly baseUrl?: string;
  /**
   * A6-A7 review Kimi R6: allow tests to inject a pre-built
   * `perScenario` map so we can prove that `optional` smokes do not
   * influence the verdict aggregation, without having to stand up a
   * fake SMOKE_INVENTORY. When supplied the runner skips the L1/L2
   * smoke executions and goes straight to aggregation.
   */
  readonly perScenarioOverride?: Record<string, VerdictBundle>;
}

/** Aggregate every required smoke into a single gate verdict. */
export async function runGate(
  options: GateOptions = {},
): Promise<GateVerdict> {
  const perScenario: Record<string, VerdictBundle> =
    options.perScenarioOverride !== undefined
      ? { ...options.perScenarioOverride }
      : await (async () => {
          const [sessionEdge, externalSeams, realProvider] = await Promise.all([
            runL1SessionEdgeSmoke({
              baseUrl: options.baseUrl,
              persist: options.persist,
            }),
            runL1ExternalSeamsSmoke({ persist: options.persist }),
            runL2RealProviderSmoke({ persist: options.persist }),
          ]);
          return {
            "l1-session-edge": sessionEdge,
            "l1-external-seams": externalSeams,
            "l2-real-provider": realProvider,
          };
        })();

  // Required smokes (see SMOKE_INVENTORY). The gate's verdict is:
  //   - red   when any required L1 scenario is red OR the L2 golden
  //           path is red (P4-01 is the load-bearing assertion),
  //   - yellow when a required L1 is green but the L2 bundle is
  //            yellow / red due to real-cloud secrets missing,
  //   - green  when every required scenario is green.
  const requiredIds = [
    ...requiredFor("L1").map((c) => c.id),
    ...requiredFor("L2").map((c) => c.id),
  ];

  const blocking: string[] = [];
  let worst: Verdict = "green";
  const requirementSummary: Record<string, Verdict> = {};
  for (const id of requiredIds) {
    const bundle = perScenario[id];
    if (!bundle) {
      worst = "red";
      blocking.push(`required smoke missing from gate run: ${id}`);
      requirementSummary[id] = "red";
      continue;
    }
    requirementSummary[id] = bundle.verdict;
    if (bundle.verdict === "red") {
      worst = "red";
      for (const b of bundle.blocking) blocking.push(`[${id}] ${b}`);
    } else if (bundle.verdict === "yellow" && worst !== "red") {
      worst = "yellow";
      for (const b of bundle.blocking) blocking.push(`[${id}] ${b}`);
    }
  }

  const verdict: GateVerdict = {
    bundleVersion: 1,
    generatedAt: new Date().toISOString(),
    verdict: worst,
    blocking,
    perScenario,
    requirementSummary,
    notes:
      worst === "red"
        ? "Gate is RED — a required scenario failed. See bundle.blocking for the triggering items."
        : worst === "yellow"
          ? "Gate is YELLOW — required L1 green but L2 real-boundary smoke is a harness fallback (OPENAI_API_KEY / NANO_AGENT_WORKERS_DEV_URL absent)."
          : "Gate is GREEN — every required smoke passed.",
  };

  if (options.persist !== false) {
    mkdirSync(BUNDLE_DIR, { recursive: true });
    const gatePath = join(BUNDLE_DIR, "gate-verdict.json");
    writeFileSync(gatePath, JSON.stringify(verdict, null, 2));

    // P6 handoff — references the aggregated bundle and each scenario.
    const handoff = {
      bundleVersion: 1,
      generatedAt: verdict.generatedAt,
      sourceGate: "test/verification/verdict-bundles/gate-verdict.json",
      verdict: verdict.verdict,
      scenarios: Object.keys(perScenario),
      consumedBy: "A7 / P6 storage-and-context-evidence-closure",
      fields: ["placement", "timeline", "latencyBaseline", "failureRecord"],
      notes:
        "Phase 6 should read placement / timeline / latencyBaseline / failureRecord fields from the per-scenario bundles.",
    };
    writeFileSync(
      join(BUNDLE_DIR, "p6-handoff.json"),
      JSON.stringify(handoff, null, 2),
    );
  }

  return verdict;
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  runGate({ persist: true, baseUrl: process.env.NANO_AGENT_WRANGLER_DEV_URL })
    .then((gate) => {
      console.log(`[a6-gate] verdict=${gate.verdict}`);
      for (const b of gate.blocking) console.log(`  blocking: ${b}`);
      if (gate.verdict === "red") process.exitCode = 1;
    })
    .catch((err) => {
      console.error("a6 gate crashed:", err);
      process.exit(2);
    });
}
