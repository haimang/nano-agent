/**
 * Export the storage-topology manifest as JSON.
 *
 * Output: dist/storage-topology.schema.json
 *
 * Contains:
 *   - The taxonomy / backend map
 *   - `DO_KEYS` / `KV_KEYS` / `R2_KEYS` shape
 *   - `DATA_ITEM_CATALOG`
 *   - `PLACEMENT_HYPOTHESES`
 *   - `CHECKPOINT_CANDIDATE_FIELDS`
 *   - `ARCHIVE_PLANS` / `PROMOTION_PLANS` / `DEMOTION_PLANS`
 *   - the provisional thresholds exposed by the calibration seam
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { storageClassToBackend } from "../src/taxonomy.js";
import { DATA_ITEM_CATALOG } from "../src/data-items.js";
import { DO_KEYS, KV_KEYS, R2_KEYS } from "../src/keys.js";
import { PLACEMENT_HYPOTHESES } from "../src/placement.js";
import { CHECKPOINT_CANDIDATE_FIELDS } from "../src/checkpoint-candidate.js";
import { ARCHIVE_PLANS } from "../src/archive-plan.js";
import { PROMOTION_PLANS } from "../src/promotion-plan.js";
import { DEMOTION_PLANS } from "../src/demotion-plan.js";
import {
  DEFAULT_DO_SIZE_THRESHOLD_BYTES,
  DEFAULT_HIGH_CONFIDENCE_MIN_SIGNALS,
  DEFAULT_MEDIUM_CONFIDENCE_MIN_SIGNALS,
  DEFAULT_HIGH_WRITE_FREQUENCY,
} from "../src/calibration.js";
import { DEFAULT_INLINE_TEXT_BYTES } from "../src/mime-gate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "dist");
mkdirSync(outDir, { recursive: true });

const team = "{team_uuid}";
const session = "{session_uuid}";

const manifest = {
  $id: "https://nano-agent.dev/schemas/storage-topology/v1",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "@nano-agent/storage-topology v1 manifest",
  description:
    "Hot/warm/cold tier map, data-item catalog, placement hypotheses, checkpoint candidates, archive/promotion/demotion plans, and provisional thresholds. Every threshold is calibrated by the runtime evidence loop — nothing is frozen.",
  taxonomy: {
    storageClassToBackend: {
      hot: storageClassToBackend("hot"),
      warm: storageClassToBackend("warm"),
      cold: storageClassToBackend("cold"),
    },
  },
  keys: {
    DO: Object.fromEntries(
      Object.entries(DO_KEYS).map(([k, v]) => [
        k,
        typeof v === "function"
          ? v("{request_uuid}")
          : v,
      ]),
    ),
    KV: Object.fromEntries(
      Object.entries(KV_KEYS).map(([k, v]) => [
        k,
        typeof v === "function" ? (v as (t?: string) => string)(team) : v,
      ]),
    ),
    R2: Object.fromEntries(
      Object.entries(R2_KEYS).map(([k, v]) => [
        k,
        (v as (...args: string[]) => string)(team, session, "{path}"),
      ]),
    ),
  },
  dataItems: DATA_ITEM_CATALOG,
  placements: Array.from(PLACEMENT_HYPOTHESES.values()),
  checkpointCandidates: CHECKPOINT_CANDIDATE_FIELDS,
  archivePlans: ARCHIVE_PLANS.map((p) => ({
    trigger: p.trigger,
    sourceBackend: p.sourceBackend,
    targetBackend: p.targetBackend,
    responsibleRuntime: p.responsibleRuntime,
    exampleKey: p.keyBuilder(team, session, "{arg0}", "{arg1}"),
  })),
  promotionPlans: PROMOTION_PLANS,
  demotionPlans: DEMOTION_PLANS,
  provisionalThresholds: {
    doSizeThresholdBytes: DEFAULT_DO_SIZE_THRESHOLD_BYTES,
    highConfidenceMinSignals: DEFAULT_HIGH_CONFIDENCE_MIN_SIGNALS,
    mediumConfidenceMinSignals: DEFAULT_MEDIUM_CONFIDENCE_MIN_SIGNALS,
    highWriteFrequency: DEFAULT_HIGH_WRITE_FREQUENCY,
    inlineTextBytes: DEFAULT_INLINE_TEXT_BYTES,
  },
};

const outPath = join(outDir, "storage-topology.schema.json");
writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log(`✅ Exported storage-topology manifest → ${outPath}`);
