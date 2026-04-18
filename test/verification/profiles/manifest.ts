/**
 * A6 Phase 1 — typed registry of verification profiles.
 *
 * Every profile has a JSON sibling under `profiles/` so review tools
 * and humans can read the binding manifest without going through
 * TypeScript. This module loads + validates the JSON shape into a
 * typed structure the runner can consume.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type LadderLayer = "L0" | "L1" | "L2";

export interface ProfileBinding {
  readonly name: string;
  readonly kind: string;
  readonly [extra: string]: unknown;
}

export interface ProfileSecret {
  readonly name: string;
  readonly source: string;
  readonly required: boolean;
  readonly note?: string;
}

export interface ProfileManifest {
  readonly id: string;
  readonly label: string;
  readonly tooling: string;
  readonly purpose: string;
  readonly bindings: readonly ProfileBinding[];
  readonly secrets: readonly ProfileSecret[];
  readonly compositionProfile: {
    readonly capability: "local" | "remote";
    readonly hooks: "local" | "remote";
    readonly provider: "local" | "remote";
  };
  readonly providerGoldenPath: string;
  readonly verdictTrigger: string;
  readonly ladderPosition?: LadderLayer;
  readonly secretInjection?: string;
  readonly smokePromptContract?: string;
  readonly smokeAssertionContract?: string;
}

const here = dirname(fileURLToPath(import.meta.url));

function load(name: string): ProfileManifest {
  const raw = readFileSync(join(here, `${name}.json`), "utf8");
  const parsed = JSON.parse(raw) as ProfileManifest;
  if (!parsed.id || !parsed.label) {
    throw new Error(`profile manifest '${name}.json' missing id/label`);
  }
  return parsed;
}

export const LOCAL_L0: ProfileManifest = load("local-l0");
export const REMOTE_DEV_L1: ProfileManifest = load("remote-dev-l1");
export const DEPLOY_SMOKE_L2: ProfileManifest = load("deploy-smoke-l2");

export const ALL_PROFILES: readonly ProfileManifest[] = [
  LOCAL_L0,
  REMOTE_DEV_L1,
  DEPLOY_SMOKE_L2,
];

/** Look up a profile by id (`local-l0` / `remote-dev-l1` / `deploy-smoke-l2`). */
export function getProfile(id: string): ProfileManifest {
  const found = ALL_PROFILES.find((p) => p.id === id);
  if (!found) {
    throw new Error(
      `unknown verification profile '${id}'. Known: ${ALL_PROFILES.map((p) => p.id).join(", ")}`,
    );
  }
  return found;
}
