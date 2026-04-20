/**
 * Context-Management — Budget env override channel.
 *
 * Operators may tune the compact policy via env variables without
 * shipping new code. The override layers on top of any caller-supplied
 * `CompactPolicyOverride`, so per-session overrides still win.
 *
 * Env keys (all uppercase):
 *   - `NANO_AGENT_COMPACT_SOFT_TRIGGER_PCT`    (float 0..1)
 *   - `NANO_AGENT_COMPACT_HARD_FALLBACK_PCT`   (float 0..1)
 *   - `NANO_AGENT_COMPACT_MIN_HEADROOM_TOKENS` (int ≥ 0)
 *   - `NANO_AGENT_COMPACT_BACKGROUND_TIMEOUT_MS` (int ≥ 0)
 *   - `NANO_AGENT_COMPACT_MAX_RETRIES_AFTER_FAILURE` (int ≥ 0)
 *   - `NANO_AGENT_COMPACT_DISABLED`            ("1" / "true" → disabled)
 *
 * Invalid values are **silently ignored** so a single typo cannot
 * break the agent's main loop; the parser surfaces the warning via
 * the optional `onWarn` callback for operators who want to escalate.
 */

import type { CompactPolicy, CompactPolicyOverride } from "./types.js";

export interface EnvLike {
  readonly [key: string]: string | undefined;
}

export interface ApplyEnvOverrideOptions {
  /** Optional callback fired for each parse failure. */
  readonly onWarn?: (message: string) => void;
}

/**
 * Returns a `CompactPolicyOverride` derived from environment variables.
 * Caller composes this with their own override:
 *
 *   `mergeCompactPolicy({ ...applyEnvOverride(env), ...sessionOverride })`
 */
export function applyEnvOverride(
  env: EnvLike,
  options: ApplyEnvOverrideOptions = {},
): CompactPolicyOverride {
  const out: Record<string, unknown> = {};
  const warn = options.onWarn ?? (() => {});

  parseFloatField(env, "NANO_AGENT_COMPACT_SOFT_TRIGGER_PCT", (v) => {
    if (v <= 0 || v >= 1) {
      warn(`NANO_AGENT_COMPACT_SOFT_TRIGGER_PCT out of range (0,1): ${v}`);
      return;
    }
    out.softTriggerPct = v;
  });
  parseFloatField(env, "NANO_AGENT_COMPACT_HARD_FALLBACK_PCT", (v) => {
    if (v <= 0 || v > 1) {
      warn(`NANO_AGENT_COMPACT_HARD_FALLBACK_PCT out of range (0,1]: ${v}`);
      return;
    }
    out.hardFallbackPct = v;
  });
  parseIntField(env, "NANO_AGENT_COMPACT_MIN_HEADROOM_TOKENS", (v) => {
    if (v < 0) {
      warn(`NANO_AGENT_COMPACT_MIN_HEADROOM_TOKENS must be >= 0: ${v}`);
      return;
    }
    out.minHeadroomTokensForBackground = v;
  });
  parseIntField(env, "NANO_AGENT_COMPACT_BACKGROUND_TIMEOUT_MS", (v) => {
    if (v < 0) {
      warn(`NANO_AGENT_COMPACT_BACKGROUND_TIMEOUT_MS must be >= 0: ${v}`);
      return;
    }
    out.backgroundTimeoutMs = v;
  });
  parseIntField(env, "NANO_AGENT_COMPACT_MAX_RETRIES_AFTER_FAILURE", (v) => {
    if (v < 0) {
      warn(`NANO_AGENT_COMPACT_MAX_RETRIES_AFTER_FAILURE must be >= 0: ${v}`);
      return;
    }
    out.maxRetriesAfterFailure = v;
  });
  const disabledRaw = env["NANO_AGENT_COMPACT_DISABLED"];
  if (disabledRaw !== undefined) {
    out.disabled = disabledRaw === "1" || disabledRaw.toLowerCase() === "true";
  }

  return out as Partial<CompactPolicy>;
}

function parseFloatField(
  env: EnvLike,
  key: string,
  apply: (v: number) => void,
): void {
  const raw = env[key];
  if (raw === undefined || raw === "") return;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return;
  apply(parsed);
}

function parseIntField(env: EnvLike, key: string, apply: (v: number) => void): void {
  const raw = env[key];
  if (raw === undefined || raw === "") return;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return;
  apply(parsed);
}
